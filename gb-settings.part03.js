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
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
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
    const panel = root.closest('.settings-panel') || root;
    if (typeof _refreshSettingsThemePanel === 'function') _refreshSettingsThemePanel();
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
function openStylePreviewPopup(previewEl) {
  if (!previewEl || typeof openFormatPopup !== 'function') return;
  if (_settingsThemeIsReadonlyElement(previewEl)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const label = previewEl.dataset.styleLabel;
  if (!label) return;
  let def = null;
  for (const list of Object.values(UI_STYLE_SECTIONS)) {
    const found = list.find(item => item.label === label);
    if (found) { def = found; break; }
  }
  if (!def) return;
  const fields = [];
  if (def.fg) fields.push('textColor');
  if (def.bg) fields.push('bgColor');
  if (def.bold) fields.push('bold');
  if (def.italic) fields.push('italic');
  const values = {
    textColor: def.fg ? getCssVar(def.fg) : '',
    bgColor: def.bg ? getCssVar(def.bg) : '',
    fontWeight: def.bold && getCssVar(def.bold) === 'bold' ? 'bold' : '',
    fontStyle: def.italic && getCssVar(def.italic) === 'italic' ? 'italic' : '',
  };
  openFormatPopup(previewEl, {
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
      }
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
  saveColorSettings();
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
  saveColorSettings();
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
        saveColorSettings();
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
  _pushSettingsColorHistory('設定: 色設定リセット', before);
  showStatus('色設定をリセットしました');
  document.querySelector('.modal-overlay').remove();
}

// ユーザー管理（ソースフォルダ別チーム表示）
let _settingsTeamFocusFolder = '';  // 設定ダイアログで選択中のフォルダ（外部から指定可能）

async function loadUserListForSettings() {
  const el = document.getElementById('settings-user-list');
  if (!el) return;
  el.innerHTML = '';
  const myName = getUsername();
  try {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    const visibleRoots = roots.filter(r => r.visible && r.path);
    if (visibleRoots.length === 0) {
      // ソースフォルダなし
      el.innerHTML = '<div style="color:var(--fg2);">ソースフォルダが設定されていません</div>';
      return;
    }
    // フォーカスフォルダが指定されていればそれだけ表示、なければ全フォルダ
    const foldersToShow = _settingsTeamFocusFolder
      ? visibleRoots.filter(r => r.path === _settingsTeamFocusFolder)
      : visibleRoots;
    if (foldersToShow.length === 0 && _settingsTeamFocusFolder) {
      // 指定フォルダが見つからない場合は全表示
      foldersToShow.push(...visibleRoots);
    }
    for (const root of foldersToShow) {
      // フォルダヘッダー
      const header = document.createElement('div');
      header.style.cssText = 'font-size:12px;font-weight:bold;color:var(--accent);padding:8px 0 4px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:4px;';
      header.innerHTML = lucide('folder', 13) + ' ' + esc(root.name || root.path.split(/[/\\]/).pop());
      el.appendChild(header);
      // メンバー一覧
      try {
        const members = await apiFetch('/team?folder=' + encodeURIComponent(root.path));
        if (members.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'color:var(--fg2);padding:4px 0;font-size:11px;';
          empty.textContent = 'メンバーなし';
          el.appendChild(empty);
          continue;
        }
        _renderTeamMemberRows(el, members, myName, root.path);
      } catch {
        const err = document.createElement('div');
        err.style.cssText = 'color:var(--fg2);padding:4px 0;font-size:11px;';
        err.textContent = '読み込みエラー';
        el.appendChild(err);
      }
    }
  } catch { el.innerHTML = '<div style="color:var(--fg2);">読み込みエラー</div>'; }
}

async function loadFileLockListForSettings() {
  const el = document.getElementById('settings-file-lock-list');
  if (!el) return;
  el.innerHTML = '<div class="gb-section-desc">読み込み中...</div>';
  try {
    if (typeof _ensureRoleLoaded === 'function') await _ensureRoleLoaded();
    if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true });
    const data = await apiFetch('/file-lock');
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (!entries.length) {
      el.innerHTML = '<div class="gb-section-desc">編集ロック中の項目はありません</div>';
      return;
    }
    const canUnlock = typeof isFileLockOwner === 'function' && isFileLockOwner();
    el.innerHTML = '';
    for (const entry of entries) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);';
      const body = document.createElement('div');
      body.style.cssText = 'flex:1;min-width:0;';
      const path = document.createElement('div');
      path.style.cssText = 'font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      path.textContent = entry.path || entry.normalized_path || '';
      path.title = path.textContent;
      body.appendChild(path);
      const meta = document.createElement('div');
      meta.className = 'gb-section-desc';
      const parts = [];
      if (entry.lock_reason) parts.push('理由: ' + entry.lock_reason);
      if (entry.locked_by) parts.push('設定者: ' + entry.locked_by);
      if (entry.locked_at) parts.push(String(entry.locked_at).replace('T', ' ').substring(0, 16));
      meta.textContent = parts.join(' / ') || '理由なし';
      body.appendChild(meta);
      row.appendChild(body);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-btn gb-btn-xs';
      btn.textContent = canUnlock ? '解除' : '閲覧のみ';
      btn.disabled = !canUnlock;
      btn.addEventListener('click', async () => {
        if (!canUnlock) return;
        try {
          await apiFetch('/file-lock?path=' + encodeURIComponent(entry.path || ''), { method: 'DELETE' });
          if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true });
          if (typeof refreshOutliner === 'function') await refreshOutliner();
          await loadFileLockListForSettings();
          showStatus('編集ロックを解除しました');
        } catch {
          showStatus('編集ロック解除に失敗しました', true);
        }
      });
      row.appendChild(btn);
      el.appendChild(row);
    }
  } catch {
    el.innerHTML = '<div style="color:var(--fg2);">読み込みエラー</div>';
  }
}

function _renderTeamMemberRows(container, members, myName, folderPath) {
  const roleLabels = { owner: '管理者', editor: '編集者', viewer: '閲覧者' };
  for (const m of members) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);';
    // アバター
    const av = document.createElement('div');
    av.style.cssText = 'width:24px;height:24px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;';
    if (m.has_avatar) {
      const avatarSrc = window.MeldexDataAccess?.team?.avatarUrl?.(m.name || 'anonymous', { folder: folderPath }) || `${API_BASE}/team/avatar/${encodeURIComponent(m.name)}?folder=${encodeURIComponent(folderPath)}&t=${Date.now()}`;
      av.innerHTML = `<img src="${esc(avatarSrc)}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      av.innerHTML = `<span style="font-size:11px;font-weight:bold;color:var(--fg2);">${esc((m.name||'?').charAt(0).toUpperCase())}</span>`;
    }
    row.appendChild(av);
    // 名前
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'flex:1 1 0;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameSpan.textContent = m.name + (m.name === myName ? '（自分）' : '');
    nameSpan.title = nameSpan.textContent;
    row.appendChild(nameSpan);
    // ロール
    const role = m.role || 'editor';
    const sel = document.createElement('select');
    sel.className = 'gb-select';
    sel.style.cssText = 'font-size:11px;padding:1px 4px;width:78px;flex-shrink:0;';
    for (const [val, label] of Object.entries(roleLabels)) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (val === role) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', async () => {
      try {
        await apiPost('/team/role', { name: m.name, role: sel.value, folder: folderPath });
        if (m.name === myName) {
          _myTeamRoles[folderPath] = sel.value;
          _myTeamRole = sel.value;
        }
        showStatus(`${m.name} を${roleLabels[sel.value]}に変更しました`);
      } catch (e) { showStatus('ロール変更に失敗しました', true); }
    });
    row.appendChild(sel);
    // 最終アクセス
    if (m.last_seen) {
      const ts = document.createElement('span');
      ts.style.cssText = 'font-size:10px;color:var(--fg2);white-space:nowrap;flex-shrink:0;';
      ts.textContent = m.last_seen.replace('T', ' ').substring(0, 16);
      row.appendChild(ts);
    }
    container.appendChild(row);
  }
}

// ユーザー編集モーダル（管理者用）
// _showEditUserModal, addUserFromSettings, removeUserFromSettings, doLogout は廃止
// （チーム方式に移行 — ユーザー管理はマイプロフィールのみ）

// アバターアップロード
function _avatarPreviewHtml(dataUrl) {
  return `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
}

async function _saveAvatarDataUrl(dataUrl, iconSpec) {
  localStorage.setItem('meldex-avatar', dataUrl);
  if (iconSpec) localStorage.setItem('meldex-avatar-spec', iconSpec);
  else localStorage.removeItem('meldex-avatar-spec');
  updateUserIcon();
  const preview = document.getElementById('settings-my-avatar');
  if (preview) preview.innerHTML = _avatarPreviewHtml(dataUrl);
  try { await apiPost('/team/sync', { name: getUsername(), avatar: dataUrl }); } catch {}
}

async function chooseAvatarIcon(anchorEl) {
  if (typeof GBIconAssets === 'undefined') {
    document.getElementById('avatar-upload-input')?.click();
    return;
  }
  GBIconAssets.openPicker({
    title: 'ユーザーアイコン',
    className: 'avatar-icon-picker',
    anchorEl: anchorEl || document.getElementById('settings-my-avatar'),
    current: localStorage.getItem('meldex-avatar-spec') || '',
    includeLucide: true,
    includeNoto: true,
    onSelect: async (spec) => {
      const normalized = GBIconAssets.normalizeSpec(spec);
      const dataUrl = GBIconAssets.toAvatarDataUrl(normalized, {
        bg: typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000',
        fg: '#d4d4d4',
      });
      await _saveAvatarDataUrl(dataUrl, normalized);
      showStatus('アイコンを更新しました');
    },
  });
}

async function refreshAvatarIconColor(color) {
  const spec = localStorage.getItem('meldex-avatar-spec');
  if (!spec || typeof GBIconAssets === 'undefined') return;
  const bg = typeof _normalizeAvatarBgColor === 'function' ? _normalizeAvatarBgColor(color) : (color || '#000000');
  const dataUrl = GBIconAssets.toAvatarDataUrl(spec, { bg, fg: '#d4d4d4' });
  await _saveAvatarDataUrl(dataUrl, spec);
}

async function uploadAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  // 画像を128x128にリサイズしてからチームファイルに同期
  const img = new Image();
  img.onload = async () => {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    // 中央トリミング
    const s = Math.min(img.width, img.height);
    const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    const dataUrl = canvas.toDataURL('image/png');
    try {
      // localStorageにキャッシュ
      await _saveAvatarDataUrl(dataUrl, '');
      showStatus('アイコンを更新しました');
    } catch(e) { showStatus('アイコンの処理に失敗しました', true); }
    URL.revokeObjectURL(objUrl);
  };
  const objUrl = URL.createObjectURL(file);
  img.src = objUrl;
  input.value = '';
}

async function removeAvatar() {
  try {
    localStorage.removeItem('meldex-avatar');
    localStorage.removeItem('meldex-avatar-spec');
    await apiPost('/team/sync', { name: getUsername(), avatar: '' });
    // チームファイルからアバター削除完了
    showStatus('アイコンを削除しました');
    updateUserIcon();
    const preview = document.getElementById('settings-my-avatar');
    if (preview) {
      preview.style.background = typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000';
      preview.innerHTML = `<span style="font-size:20px;font-weight:bold;color:var(--fg2);">${getUsername().charAt(0).toUpperCase()}</span>`;
    }
  } catch(e) {}
}

// ユーザーアイコンを更新
function updateUserIcon() {
  const el = document.getElementById('btn-' + 'user');
  const localName = getUsername();
  if (el) {
    el.title = localName || 'ユーザー';
    // localStorageのアバターを即座に表示
    const cachedAvatar = localStorage.getItem('meldex-avatar');
    if (cachedAvatar) {
      el.innerHTML = `<img src="${cachedAvatar}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`;
    } else {
      const ch = (localName || '?').charAt(0).toUpperCase();
      const avBg = typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000';
      el.innerHTML = `<span class="user-avatar-bg" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${avBg};font-size:12px;font-weight:bold;color:var(--fg2);">${esc(ch)}</span>`;
    }
  }
  if (typeof updateLeftChromeUser === 'function') updateLeftChromeUser();
}

// ユーザーアバターHTML（チャットフキダシ用）
function getUserAvatarHtml(username, size) {
  size = size || 20;
  const fallbackChar = (typeof esc === 'function' ? esc((username || '?').charAt(0).toUpperCase()) : String((username || '?').charAt(0).toUpperCase()).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const baseStyle = `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;`;
  const rawSrc = window.MeldexDataAccess?.team?.avatarUrl?.(username || 'anonymous', {}) || `${API_BASE}/team/avatar/${encodeURIComponent(username)}?t=0`;
  const src = typeof esc === 'function' ? esc(rawSrc) : String(rawSrc).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<span style="${baseStyle}">
    <img src="${src}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';">
    <span style="display:none;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:var(--bg4);font-size:${Math.round(size*0.55)}px;font-weight:bold;color:var(--fg2);">${fallbackChar}</span>
  </span>`;
}

// 旧認証関数（generatePassword, addUser, removeUser, doLogout）は廃止済み

function _syncSettingsModalOverlayForPanel(modalOrOverlay, panelName) {
  const overlay = modalOrOverlay?.classList?.contains?.('modal-overlay')
    ? modalOrOverlay
    : modalOrOverlay?.closest?.('.modal-overlay') || document.querySelector('.modal-overlay[data-settings-modal="1"]');
  if (!overlay) return;
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  const isThemePanel = canonical === 'テーマ';
  overlay.classList.toggle('no-dim', isThemePanel);
  overlay.dataset.settingsPreviewMode = isThemePanel ? 'theme' : '';
}

function _ensureSettingsThemePanelVisible(panelName, root) {
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  if (canonical !== 'テーマ' || typeof ensureSettingsThemePanel !== 'function') return;
  const scope = root?.closest?.('.modal') || root || document;
  const panel = scope.querySelector?.('.settings-panel[data-panel="テーマ"]');
  if (panel) ensureSettingsThemePanel(panel);
}

const _SETTINGS_PANEL_INIT_DATA_KEYS = {
  '全般': 'settingsInitGeneral',
  'テーマ': 'settingsInitTheme',
  'LLM': 'settingsInitLlm',
  'LLMコスト': 'settingsInitChatCost',
  'Discord Bot': 'settingsInitDiscordBot',
  'フィードバック': 'settingsInitFeedbackForm',
  'ユーザー': 'settingsInitUsers',
  '拡張機能': 'settingsInitExtensions',
  'ショートカット': 'settingsInitShortcuts',
  'ゴミ箱': 'settingsInitTrash',
  'データベース': 'settingsInitDatabaseMaintenance',
};

function _scheduleSettingsPanelInitialization(panelName, root, options = {}) {
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  const key = _SETTINGS_PANEL_INIT_DATA_KEYS[canonical];
  if (!key) return;
  const overlay = root?.classList?.contains?.('modal-overlay')
    ? root
    : root?.closest?.('.modal-overlay') || document.querySelector('.modal-overlay[data-settings-modal="1"]');
  const modal = overlay?.querySelector?.('.modal') || root?.closest?.('.modal');
  if (!modal || modal.dataset[key] === '1') return;
  modal.dataset[key] = '1';
  const run = () => {
    if (!modal.isConnected) return;
    if (canonical === '全般') {
      if (typeof loadOutlinerRootsForSettings === 'function') loadOutlinerRootsForSettings();
      if (typeof loadStorageInfoForSettings === 'function') loadStorageInfoForSettings();
      if (typeof loadMobileAccessUrlsForSettings === 'function') loadMobileAccessUrlsForSettings();
      if (typeof loadSettingsTransferStatusForSettings === 'function') loadSettingsTransferStatusForSettings();
      if (typeof _loadAutostartStateForSettings === 'function') _loadAutostartStateForSettings();
      return;
    }
    if (canonical === 'テーマ') {
      _ensureSettingsThemePanelVisible(canonical, modal);
      return;
    }
    if (canonical === 'LLM') {
      if (typeof _loadLlmConfigForSettings === 'function') _loadLlmConfigForSettings();
      if (typeof renderKnowledgeAutomationSettings === 'function') renderKnowledgeAutomationSettings(modal);
      return;
    }
    if (canonical === 'LLMコスト') {
      if (typeof renderChatCostSettings === 'function') renderChatCostSettings(modal);
      return;
    }
    if (canonical === 'Discord Bot') {
      if (typeof renderDiscordBotSettings === 'function') renderDiscordBotSettings(modal);
      return;
    }
    if (canonical === 'フィードバック' && typeof renderMeldexFeedbackPanel === 'function') {
      renderMeldexFeedbackPanel(modal);
      if (typeof renderMeldexFeedbackSettingsPanel === 'function') renderMeldexFeedbackSettingsPanel(modal);
      return;
    }
    if (canonical === 'ユーザー') {
      if (typeof loadUserListForSettings === 'function') loadUserListForSettings();
      if (typeof loadFileLockListForSettings === 'function') loadFileLockListForSettings();
      return;
    }
    if (canonical === '拡張機能' && typeof _loadExtensionStatus === 'function') {
      if (typeof renderNotionSyncSettings === 'function') renderNotionSyncSettings(modal);
      _loadExtensionStatus();
      return;
    }
    if (canonical === 'ショートカット') {
      const container = modal.querySelector('#shortcut-settings-container');
      if (container && typeof renderShortcutSettings === 'function') renderShortcutSettings(container);
      return;
    }
    if (canonical === 'ゴミ箱') {
      if (typeof renderTrashSettings === 'function') renderTrashSettings(modal);
      return;
    }
    if (canonical === 'データベース') {
      if (typeof renderDatabaseMaintenanceSettings === 'function') renderDatabaseMaintenanceSettings(modal);
      return;
    }
  };
  if (options.immediate === true) {
    run();
    return;
  }
  const defer = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 0);
  defer(() => setTimeout(run, 0));
}

function switchSettingsTab(el) {
  const tabName = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(el.dataset.tab) : el.dataset.tab;
  // タブヘッダー (gb-inner-tab-active クラス切替、旧インライン style をクリア)
  el.parentElement.querySelectorAll('.settings-tab').forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle('gb-inner-tab-active', active);
    t.classList.toggle('active', active);
    t.style.borderBottomColor = '';
    t.style.color = '';
    t.style.fontWeight = '';
  });
  // パネル (hidden 属性で切替)
  el.closest('.modal').querySelectorAll('.settings-panel').forEach(p => {
    p.hidden = p.dataset.panel !== tabName;
    p.style.display = '';
  });
  _ensureSettingsThemePanelVisible(tabName, el);
  _syncSettingsModalOverlayForPanel(el, tabName);
  _scheduleSettingsPanelInitialization(tabName, el);
}

// モバイル: セクションドリルダウン
function _openSettingsSection(panelName) {
  const modal = document.querySelector('.modal-overlay .modal');
  if (!modal) return;
  panelName = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName) : panelName;
  const navList = document.getElementById('settings-nav-list');
  if (navList) navList.hidden = true;
  modal.querySelectorAll('.settings-panel').forEach(p => {
    p.hidden = p.dataset.panel !== panelName;
    p.style.display = '';
  });
  _ensureSettingsThemePanelVisible(panelName, modal);
  _syncSettingsModalOverlayForPanel(modal, panelName);
  _scheduleSettingsPanelInitialization(panelName, modal);
  const btnRow = modal.querySelector('.btn-row');
  if (btnRow) btnRow.hidden = false;
  const backBtn = document.getElementById('settings-back-btn');
  if (backBtn) backBtn.hidden = false;
  const headerText = document.getElementById('settings-header-text');
  if (headerText) {
    headerText.textContent = typeof _settingsPanelDisplayName === 'function'
      ? _settingsPanelDisplayName(panelName)
      : panelName;
  }
}
function _backToSettingsList() {
  const modal = document.querySelector('.modal-overlay .modal');
  if (!modal) return;
  modal.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; p.style.display = ''; });
  const btnRow = modal.querySelector('.btn-row');
  if (btnRow) btnRow.hidden = true;
  const navList = document.getElementById('settings-nav-list');
  if (navList) navList.hidden = false;
  const backBtn = document.getElementById('settings-back-btn');
  if (backBtn) backBtn.hidden = true;
  const headerText = document.getElementById('settings-header-text');
  if (headerText) headerText.innerHTML = '<span class="ico ico-settings"></span> 設定';
  _syncSettingsModalOverlayForPanel(modal, '');
  replaceIcons(modal);
}

async function _loadExtensionStatus() {
  const el = document.getElementById('ext-status');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--fg2);">読み込み中...</span>';
  try {
    const status = await apiFetch('/extensions/status');
    const exts = [
      { key: 'pillow', name: 'Pillow（画像処理）', desc: '重複画像検出に必要', size: '~3MB', installed: status.pillow },
      { key: 'clip', name: 'CLIP（画像類似検索）', desc: 'テキストで画像を検索。Pillowも同時にインストールされます', size: '~2GB', installed: status.clip },
      { key: 'caldav', name: 'CalDAV（カレンダー同期）', desc: 'iPhone/Thunderbird等とカレンダーを双方向同期', size: '~5MB', installed: status.caldav },
    ];
    el.innerHTML = exts.map(ext => `<div style="display:flex;align-items:center;gap:10px;padding:8px;margin-bottom:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);">
      <div style="flex:1;">
        <div style="font-weight:bold;font-size:13px;color:var(--fg);">${ext.name}</div>
        <div style="font-size:11px;color:var(--fg2);">${ext.desc}</div>
        <div style="font-size:11px;color:var(--fg2);">サイズ: ${ext.size}</div>
      </div>
      ${ext.installed
        ? `<span style="color:var(--green);font-size:12px;font-weight:bold;">${lucide('check', 12)} インストール済み</span>`
        : `<button data-action="_installExtension('${ext.key}', this)" style="padding:4px 14px;font-size:12px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;">インストール</button>`
      }
    </div>`).join('');

    // CalDAVが有効なら接続情報を表示
    if (status.caldav) {
      try {
        const info = await apiFetch('/caldav/info');
        el.innerHTML += `<div style="padding:8px;margin-top:8px;border:1px solid var(--accent);border-radius:4px;background:var(--bg2);">
          <div style="font-weight:bold;font-size:13px;color:var(--accent);margin-bottom:6px;">CalDAV接続情報</div>
          <div style="font-size:12px;color:var(--fg);margin-bottom:4px;">URL: <code style="background:var(--bg);padding:2px 6px;border-radius:3px;user-select:all;">${esc(info.url)}</code></div>
          <div style="font-size:11px;color:var(--fg2);margin-bottom:2px;">iPhone: ${esc(info.instructions.iphone)}</div>
          <div style="font-size:11px;color:var(--fg2);margin-bottom:2px;">Thunderbird: ${esc(info.instructions.thunderbird)}</div>
          <div style="font-size:11px;color:var(--fg2);">Google: ${esc(info.instructions.google)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;">
            <button data-action="apiPost('/caldav/sync-to-ics').then(r=>showStatus('同期完了: '+r.synced+'件'))" style="font-size:11px;padding:3px 10px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;">シート → CalDAV同期</button>
            <button data-action="apiPost('/caldav/sync-from-ics').then(r=>showStatus('取込: '+r.imported+'件, 更新: '+r.updated+'件'))" style="font-size:11px;padding:3px 10px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;">CalDAV → シート同期</button>
          </div>
        </div>`;
      } catch {}
    }
  } catch {
    el.innerHTML = '<span style="color:var(--red);">ステータスの取得に失敗しました</span>';
  }
}

async function _installExtension(key, btn) {
  btn.disabled = true;
  btn.textContent = 'インストール中...';
  btn.style.background = 'var(--bg4)';
  btn.style.color = 'var(--fg2)';
  try {
    const res = await apiPost('/extensions/install', { extension: key });
    if (res.ok) {
      btn.innerHTML = lucide('check', 12) + ' 完了（再起動で有効）';
      btn.style.background = 'var(--green)';
      btn.style.color = '#fff';
      showStatus(res.message);
    } else {
      btn.textContent = '失敗';
      btn.style.background = 'var(--red)';
      btn.style.color = '#fff';
      showStatus('インストール失敗: ' + res.error, true);
    }
  } catch (e) {
    btn.textContent = 'エラー';
    btn.style.background = 'var(--red)';
    btn.style.color = '#fff';
    showStatus('インストールエラー: ' + (e.message || e), true);
  }
}

const SETTINGS_RESET_HISTORY_SESSION_KEY = 'meldex:settings-reset-history';

function _captureAllLocalStorageSettings(extraKeys = []) {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  const keys = new Set(Array.isArray(extraKeys) ? extraKeys.filter(Boolean) : []);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.add(key);
    }
  } catch {}
  return captureLocalStorageSettings([...keys]);
}

async function _captureSettingsResetSnapshot(extraStorageKeys = []) {
  const [sourceFolders, uiConfig] = await Promise.all([
    typeof captureOutlinerRootsSettingsSnapshot === 'function'
      ? captureOutlinerRootsSettingsSnapshot().catch(() => null)
      : Promise.resolve(null),
    typeof apiFetch === 'function'
      ? apiFetch('/ui-config').catch(() => ({}))
      : Promise.resolve({}),
  ]);
  return {
    storage: _captureAllLocalStorageSettings(extraStorageKeys),
    sourceFolders,
    uiConfig: uiConfig || {},
  };
}

async function _restoreSettingsResetSnapshot(snapshot) {
  if (!snapshot) return false;
  const storageSnapshot = snapshot.storage;
  if (storageSnapshot && typeof restoreLocalStorageSettings === 'function') {
    restoreLocalStorageSettings(storageSnapshot, keys => {
      if (typeof _restoreSettingsDialogStorageAfterHistory === 'function') {
        _restoreSettingsDialogStorageAfterHistory(keys);
      }
    });
  }
  if (typeof apiPut === 'function') {
    try { await apiPut('/ui-config', snapshot.uiConfig || {}); } catch {}
  }
  if (snapshot.sourceFolders && typeof _restoreOutlinerRootsSettingsSnapshot === 'function') {
    await _restoreOutlinerRootsSettingsSnapshot(snapshot.sourceFolders);
  } else if (typeof loadOutliner === 'function') {
    try { await loadOutliner(); } catch {}
  }
  return true;
}

async function _registerPendingSettingsResetHistory() {
  let raw = '';
  try { raw = sessionStorage.getItem(SETTINGS_RESET_HISTORY_SESSION_KEY) || ''; } catch {}
  if (!raw) return;
  try { sessionStorage.removeItem(SETTINGS_RESET_HISTORY_SESSION_KEY); } catch {}
  let payload = null;
  try { payload = JSON.parse(raw); } catch {}
  const before = payload?.before;
  if (!before || typeof historyPush !== 'function') return;
  const beforeKeys = before.storage?.keys || Object.keys(before.storage?.storage || {});
  const after = await _captureSettingsResetSnapshot(beforeKeys);
  let beforeStorage = before.storage;
  let afterStorage = after.storage;
  if (typeof _normalizeLocalStorageSettingsSnapshots === 'function') {
    const normalized = _normalizeLocalStorageSettingsSnapshots(before.storage, after.storage);
    beforeStorage = normalized.before;
    afterStorage = normalized.after;
  }
  const undoSnapshot = { ...before, storage: beforeStorage };
  const redoSnapshot = { ...after, storage: afterStorage };
  historyPush(
    '設定: 全設定初期化',
    () => _restoreSettingsResetSnapshot(undoSnapshot),
    () => _restoreSettingsResetSnapshot(redoSnapshot),
    'settings:reset',
    'リセット前の設定を復元'
  );
}

function _schedulePendingSettingsResetHistoryRegistration() {
  let attempts = 0;
  const run = () => {
    if (typeof historyPush !== 'function' && attempts < 20) {
      attempts += 1;
      setTimeout(run, 250);
      return;
    }
    _registerPendingSettingsResetHistory().catch(() => {});
  };
  setTimeout(run, 250);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _schedulePendingSettingsResetHistoryRegistration, { once: true });
  } else {
    _schedulePendingSettingsResetHistoryRegistration();
  }
}

async function resetAllSettings() {
  const beforeReset = await _captureSettingsResetSnapshot();
  try {
    sessionStorage.setItem(SETTINGS_RESET_HISTORY_SESSION_KEY, JSON.stringify({ before: beforeReset, at: Date.now() }));
  } catch {}
  localStorage.clear();
  // サーバー側の設定もクリア
  try { await apiPut('/outliner-roots', { roots: [] }); } catch {}
  try { await apiPut('/ui-config', {}); } catch {}
  try { await apiPut('/vault', { path: '' }); } catch {}
  location.reload();
}

async function submitSettings() {
  showLoading('設定を保存中...');
  try {
  const settingsOverlay = document.querySelector('.modal-overlay[data-settings-modal="1"]');
  const settingsHistoryBefore = typeof _captureSettingsDialogStorageSnapshot === 'function'
    ? _captureSettingsDialogStorageSnapshot()
    : null;
  // select の change が未発火でも、保存前に共通フォントをテーマ変数へ確定する。
  const fontFamily = document.getElementById('modal-font-family')?.value || '';
  if (typeof settingsThemeApplyCommonFont === 'function') settingsThemeApplyCommonFont(fontFamily);

  // テーマ編集があれば、設定ダイアログの保存ボタンでも選択中テーマへ反映する。
  if (typeof settingsThemeSaveFromSettingsDialog === 'function') {
    const themeSaveOk = await settingsThemeSaveFromSettingsDialog({ skipRefresh: true });
    if (themeSaveOk === false) return;
  }

  if (typeof savePublishSettingsFromPanel === 'function') {
    const publishSaveOk = await savePublishSettingsFromPanel(settingsOverlay);
    if (publishSaveOk === false) return;
  }

  if (typeof saveDiscordBotSettingsFromSettingsDialog === 'function') {
    const discordSaveOk = await saveDiscordBotSettingsFromSettingsDialog({ silent: true, skipRender: true });
    if (discordSaveOk === false) return;
  }

  if (typeof saveChatCostSettingsFromSettingsDialog === 'function') {
    const chatCostSaveOk = await saveChatCostSettingsFromSettingsDialog(settingsOverlay, { silent: true });
    if (chatCostSaveOk === false) return;
  }

  // テーマをlocalStorageに保存
  saveColorSettings();
