      if (!pickedHex) return;
      hsb = _hexToHsb(pickedHex);
      selectedIsTransparent = false;
      selectedCustomIdx = -1;
      selectedPresetIdx = -1;
      selectedOsAccentTone = '';
      updateSliders(); updatePicker(); updateSwatchHighlights();
      applyLive();
    } catch {
      // 取得キャンセル等は無視
    }
  });

  function applyOsAccentColor(hex, tone) {
    hsb = _hexToHsb(hex);
    selectedIsTransparent = false;
    selectedCustomIdx = -1;
    selectedPresetIdx = -1;
    selectedOsAccentTone = tone || '';
    updateSliders(); updatePicker(); updateSwatchHighlights();
    applyLive();
  }

  function setOsAccentSwatchesDisabled(disabled) {
    osAccentSwatches.forEach(btn => { btn.disabled = !!disabled; });
  }

  function refreshOsAccentSwatches(sourceColor, options = {}) {
    const variants = getPaletteOsAccentVariants(sourceColor);
    osAccentSwatches.forEach(btn => {
      const info = variants.find(v => v.tone === btn.dataset.osAccentTone);
      const color = info?.color || '';
      btn.style.background = color || info?.fallback || 'var(--theme-os-accent, AccentColor)';
      btn.dataset.hex = color;
      btn.title = color ? `${btn.dataset.osAccentLabel}: ${color}` : btn.dataset.osAccentLabel;
    });
    if (options.applySelected && selectedOsAccentTone) {
      const selected = variants.find(v => v.tone === selectedOsAccentTone);
      if (selected?.color) applyOsAccentColor(selected.color, selected.tone);
    } else {
      updateSwatchHighlights();
    }
  }

  const osAccentSwatches = getPaletteOsAccentVariants(getPaletteOsAccentColor()).map(info => {
    const btn = document.createElement('button');
    btn.className = 'gb-swatch gb-palette-os-accent-swatch';
    btn.type = 'button';
    btn.dataset.type = 'os-accent';
    btn.dataset.osAccentTone = info.tone;
    btn.dataset.osAccentLabel = info.label;
    btn.dataset.e2eId = `color-palette-os-accent-${info.tone}`;
    btn.setAttribute('data-palette-os-accent-swatch', info.tone);
    btn.setAttribute('aria-label', `${info.label}カラーを設定`);
    btn.style.background = info.color || info.fallback || 'var(--theme-os-accent, AccentColor)';
    btn.dataset.hex = info.color || '';
    btn.title = info.color ? `${info.label}: ${info.color}` : info.label;
    btn.addEventListener('click', async () => {
      setOsAccentSwatchesDisabled(true);
      try {
        const base = await resolvePaletteOsAccentColor();
        refreshOsAccentSwatches(base);
        const next = getPaletteOsAccentVariants(base).find(v => v.tone === info.tone);
        if (!next?.color) {
          if (typeof showStatus === 'function') showStatus('OSアクセントカラーを取得できません', true);
          return;
        }
        applyOsAccentColor(next.color, next.tone);
      } finally {
        setOsAccentSwatchesDisabled(false);
      }
    });
    return btn;
  });

  resolvePaletteOsAccentColor().then(color => refreshOsAccentSwatches(color));
  const onOsAccentChange = (ev) => refreshOsAccentSwatches(ev?.detail?.color || getPaletteOsAccentColor(), { applySelected: true });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('meldex-theme-os-accent-change', onOsAccentChange);
  }

  pickerRow.append(picker, saveBtn, eyedropBtn, ...osAccentSwatches);
  palette.appendChild(pickerRow);

  const hSlider = makeSlider('色相', 0, 360, hsb.h, v => { hsb.h = v; onSliderChange(); });
  const sSlider = makeSlider('彩度', 0, 100, hsb.s, v => { hsb.s = v; onSliderChange(); });
  const bSlider = makeSlider('明度', 0, 100, hsb.b, v => { hsb.b = v; onSliderChange(); });
  sliderSection.append(hSlider.row, sSlider.row, bSlider.row);
  palette.appendChild(sliderSection);

  function updateSliderVisuals() {
    const hue = ((Number(hsb.h) % 360) + 360) % 360;
    const saturation = Math.max(0, Math.min(100, Number(hsb.s) || 0));
    const brightness = Math.max(0, Math.min(100, Number(hsb.b) || 0));
    hSlider.slider.style.setProperty('--gb-color-axis-gradient', 'linear-gradient(to right, #f00 0%, #ff0 16.667%, #0f0 33.333%, #0ff 50%, #00f 66.667%, #f0f 83.333%, #f00 100%)');
    hSlider.slider.style.setProperty('--gb-color-axis-thumb', `hsl(${hue} 100% 50%)`);
    sSlider.slider.style.setProperty('--gb-color-axis-gradient', `linear-gradient(to right, hsl(${hue} 0% 50%), hsl(${hue} 100% 50%))`);
    sSlider.slider.style.setProperty('--gb-color-axis-thumb', `hsl(${hue} ${saturation}% 50%)`);
    bSlider.slider.style.setProperty('--gb-color-axis-gradient', `linear-gradient(to right, #000, ${_hsbToHex(hue, saturation, 100)})`);
    bSlider.slider.style.setProperty('--gb-color-axis-thumb', _hsbToHex(hue, saturation, brightness));
  }

  function onSliderChange() { selectedIsTransparent = false; selectedCustomIdx = -1; selectedPresetIdx = -1; selectedOsAccentTone = ''; updatePicker(); updateSliderVisuals(); updateSwatchHighlights(); applyLive(); }
  function updateSliders() {
    hSlider.slider.value = hsb.h; hSlider.valInput.value = hsb.h;
    sSlider.slider.value = hsb.s; sSlider.valInput.value = hsb.s;
    bSlider.slider.value = hsb.b; bSlider.valInput.value = hsb.b;
    updateSliderVisuals();
    globalThis.GBUI?.refreshRangeFills?.(sliderSection);
  }

  // --- 閉じるボタン行 ---
  const closeRow = document.createElement('div');
  closeRow.className = 'gb-palette-close-row';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'gb-btn-close'; closeBtn.textContent = '閉じる';
  closeBtn.dataset.e2eId = 'color-palette-close';
  closeBtn.title = 'カラーパレットを閉じる';
  closeBtn.setAttribute('aria-label', 'カラーパレットを閉じる');
  closeBtn.addEventListener('click', () => { if (typeof onClose === 'function') onClose(); });
  closeRow.appendChild(closeBtn);
  palette.appendChild(closeRow);

  // パレット要素が DOM から外れたら購読を解除する
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
    const cleanup = () => {
      if (!palette.isConnected) {
        if (typeof document.removeEventListener === 'function') {
          document.removeEventListener('gb-standard-palette-adjust-change', _onStandardPaletteAdjustChange);
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('meldex-theme-os-accent-change', onOsAccentChange);
        }
        paletteObserver?.disconnect?.();
      }
    };
    const filter = (mutation) => !palette.isConnected || Array.from(mutation.removedNodes || []).some((node) => node === palette || !!node.contains?.(palette));
    const paletteObserver = window.GBMutationBus
      ? window.GBMutationBus.subscribe('color-palette-' + Math.random().toString(36).slice(2), { filter, callback: cleanup, throttle: 50 })
      : new MutationObserver(cleanup);
    if (!window.GBMutationBus) paletteObserver.observe(document.body, { childList: true, subtree: true });
  }

  // --- 更新関数 ---
  function updatePicker() { picker.value = currentHex(); }
  function updateSwatchHighlights() {
    const hex = currentHex().toLowerCase();
    presetMatrix.querySelectorAll('.gb-swatch').forEach(sw => {
      if (sw.dataset.type === 'transparent') sw.classList.toggle('selected', selectedIsTransparent);
      else sw.classList.toggle('selected', !selectedIsTransparent && selectedPresetIdx === parseInt(sw.dataset.presetIdx, 10) && sw.dataset.hex === hex);
    });
    customGrid.querySelectorAll('.gb-swatch').forEach(sw => {
      sw.classList.toggle('selected', !selectedIsTransparent && selectedCustomIdx === parseInt(sw.dataset.customIdx));
    });
    osAccentSwatches.forEach(sw => {
      sw.classList.toggle('selected', !selectedIsTransparent && selectedOsAccentTone === sw.dataset.osAccentTone && hex === _colorValueToHex(sw.dataset.hex));
    });
  }

  updateSliderVisuals();
  updateSwatchHighlights();
  return palette;
}
