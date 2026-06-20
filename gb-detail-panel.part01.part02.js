    return wrap;
  }
  if (field.type === 'boardBgFit') {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
    const sel = document.createElement('select');
    sel.className = 'gb-select';
    sel.disabled = !(typeof bd !== 'undefined' && bd._bgImage);
    _fsSetControlE2e(sel, field, rowLabel, 'fit');
    const curFit = (typeof _bdNormalizeBackgroundFit === 'function') ? _bdNormalizeBackgroundFit(typeof bd !== 'undefined' ? bd._bgImageFit : '') : 'contain';
    [
      ['contain', '全体'],
      ['cover', '余白なし'],
      ['auto', '原寸'],
      ['repeat', 'タイル'],
      ['world', 'ボード追従'],
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === curFit;
      sel.appendChild(opt);
    });
    // ボード追従モード専用: 倍率入力
    const scaleInput = document.createElement('input');
    scaleInput.type = 'number';
    scaleInput.className = 'gb-input gb-fmt-num';
    scaleInput.min = '0.05';
    scaleInput.max = '20';
    scaleInput.step = '0.1';
    scaleInput.style.width = '64px';
    scaleInput.title = '背景画像の表示倍率 (ボード追従モード)';
    _fsSetControlE2e(scaleInput, field, rowLabel, 'scale');
    const curScale = (typeof bd !== 'undefined' && Number.isFinite(Number(bd._bgImageScale))) ? Number(bd._bgImageScale) : 1;
    scaleInput.value = String(curScale);
    const updateScaleVisibility = () => {
      const active = sel.value === 'world' && !!(typeof bd !== 'undefined' && bd._bgImage);
      scaleInput.style.display = active ? '' : 'none';
    };
    updateScaleVisibility();
    sel.addEventListener('change', () => {
      if (typeof bdSetBoardBackgroundImageFit === 'function') bdSetBoardBackgroundImageFit(sel.value);
      updateScaleVisibility();
    });
    scaleInput.addEventListener('change', () => {
      if (typeof bdSetBoardBackgroundImageScale === 'function') bdSetBoardBackgroundImageScale(Number(scaleInput.value));
    });
    wrap.append(sel, scaleInput);
    return wrap;
  }
  if (field.type === 'select') {
    const sel = document.createElement('select');
    sel.className = 'gb-select';
    sel.title = field.label;
    _fsSetControlE2e(sel, field, rowLabel, 'select');
    const options = typeof field.options === 'function' ? field.options(cur) : (field.options || []);
    if (typeof options === 'string') {
      sel.innerHTML = options;
    } else if (Array.isArray(options)) {
      options.forEach(optData => {
        const opt = document.createElement('option');
        opt.value = optData.v || '';
        opt.textContent = optData.l || optData.v || '';
        if (optData.style) opt.setAttribute('style', optData.style);
        sel.appendChild(opt);
      });
    }
    sel.value = cur || '';
    sel.addEventListener('change', () => {
      const raw = _fsNormalizeFieldValue(field, sel.value);
      sel.value = raw || '';
      adapter.set(field, raw || '');
      adapter.applyCss(field, raw || '');
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(sel, field, adapter, raw);
    });
    return sel;
  }
  if (field.type === 'color') {
    if (field.bgType === 'rgba' && typeof parseColorToHexAlpha === 'function' && typeof hexAlphaToRgba === 'function') {
      const wrap = document.createElement('span');
      wrap.className = 'gb-fmt-popup-group';
      const parsed = parseColorToHexAlpha(cur);
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'gb-fmt-swatch-bg';
      sw.style.background = cur || field.fallback || 'var(--bg3)';
      sw.title = field.label;
      sw.dataset.hex = parsed.hex;
      _fsSetControlE2e(sw, field, rowLabel, 'swatch');
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(parsed.alpha * 100));
      slider.className = 'cs-alpha';
      _fsSetControlE2e(slider, field, rowLabel, 'alpha');
      const val = document.createElement('span');
      val.className = 'cs-alpha-val';
      val.textContent = slider.value + '%';
      const applyRgba = () => {
        const raw = hexAlphaToRgba(sw.dataset.hex || '#000000', parseInt(slider.value, 10) / 100);
        adapter.set(field, raw);
        sw.style.background = raw || field.fallback || 'var(--bg3)';
        adapter.applyCss(field, raw);
        val.textContent = slider.value + '%';
        globalThis.GBUI?.refreshRangeFill?.(slider);
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(wrap, field, adapter, raw);
      };
      sw.addEventListener('click', () => {
        if (typeof openColorPalette !== 'function') return;
        openColorPalette(sw, sw.dataset.hex || cur || '', (color) => {
          if (color === 'transparent') {
            slider.value = '0';
            sw.dataset.hex = '#000000';
          } else if (color) {
            sw.dataset.hex = color;
          }
          applyRgba();
        });
      });
      slider.addEventListener('input', applyRgba);
      wrap.append(sw, slider, val);
      return wrap;
    }
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'gb-fmt-swatch-bg';
    if (field.applyCustom === 'bgColor') sw.id = 'bd-bg-swatch';
    sw.style.background = cur || field.fallback || 'var(--bg3)';
    sw.title = field.label;
    sw.dataset.value = cur || '';
    _fsSetControlE2e(sw, field, rowLabel, 'swatch');
    sw.addEventListener('click', () => {
      if (typeof openColorPalette !== 'function') return;
      openColorPalette(sw, sw.dataset.value || '', (color) => {
        const raw = color === 'transparent' ? '' : color;
        adapter.set(field, raw);
        sw.style.background = raw || field.fallback || 'var(--bg3)';
        sw.dataset.value = raw || '';
        adapter.applyCss(field, raw);
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(sw, field, adapter, raw);
      });
    });
    return sw;
  }
  if (field.type === 'checkbox') {
    // defaultOn 付きのチェックボックス。on/off は保存値（例: '1'/'0'）。未設定時は defaultOn を参照
    const unset = cur === undefined || cur === null || cur === '';
    const checked = unset ? !!field.defaultOn : (cur === field.on);
    const wrap = document.createElement('label');
    wrap.className = 'bd-detail-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    _fsSetControlE2e(input, field, rowLabel, 'checkbox');
    input.addEventListener('change', () => {
      const nextValue = input.checked ? field.on : field.off;
      adapter.set(field, nextValue);
      adapter.applyCss(field, nextValue);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(input, field, adapter, nextValue);
    });
    const txt = document.createElement('span');
    // rowLabel と重複するプレフィックスがあれば短縮。他タブの toggle 類と同じ扱い
    txt.textContent = _fsShortLabel(field, rowLabel);
    wrap.append(input);
    if (txt.textContent) wrap.appendChild(txt);
    return wrap;
  }
  if (field.type === 'toggle') {
    // defaultOn: 値未設定時のデフォルト表示 (bd.autoAlign のように明示的オフのみ保存したい項目用)
    const isOn = _fsIsToggleOn(field, cur);
    const handleToggle = (btn) => {
      const nextOn = !btn.classList.contains('active');
      btn.classList.toggle('active', nextOn);
      const nextValue = nextOn ? field.on : field.off;
      adapter.set(field, nextValue);
      adapter.applyCss(field, nextValue);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(btn, field, adapter, nextValue);
    };
    if (typeof field.on === 'boolean' && typeof field.off === 'boolean') {
      const wrap = document.createElement('label');
      wrap.className = 'bd-detail-check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = isOn;
      input.title = field.label;
      _fsSetControlE2e(input, field, rowLabel, 'toggle-checkbox');
      input.addEventListener('change', () => {
        const nextValue = input.checked ? field.on : field.off;
        adapter.set(field, nextValue);
        adapter.applyCss(field, nextValue);
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(input, field, adapter, nextValue);
      });
      const txt = document.createElement('span');
      txt.textContent = _fsShortLabel(field, rowLabel);
      wrap.append(input);
      if (txt.textContent) wrap.appendChild(txt);
      return wrap;
    }
    if (field.on === 'bold' || field.on === 'italic') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-fmt-btn' + (isOn ? ' active' : '');
      btn.innerHTML = field.on === 'bold' ? '<b>B</b>' : '<i>I</i>';
      btn.title = field.label;
      _fsSetControlE2e(btn, field, rowLabel, field.on === 'bold' ? 'bold' : 'italic');
      btn.addEventListener('click', () => handleToggle(btn));
      return btn;
    }
    // bool/その他のトグルはテキスト付きボタン。行プレフィックスがあれば短縮表示
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-btn' + (isOn ? ' active' : '');
    btn.textContent = _fsShortLabel(field, rowLabel);
    btn.title = field.label;
    _fsSetControlE2e(btn, field, rowLabel, 'toggle');
    btn.addEventListener('click', () => handleToggle(btn));
    return btn;
  }
  if (field.type === 'number') {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'gb-fmt-num';
    if (field.min !== undefined) inp.min = String(field.min);
    if (field.max !== undefined) inp.max = String(field.max);
    if (field.step !== undefined) inp.step = String(field.step);
    inp.value = (cur !== undefined && cur !== null && cur !== '') ? String(cur) : '';
    inp.placeholder = '—';
    inp.title = field.label;
    _fsSetControlE2e(inp, field, rowLabel, 'number');
    inp.addEventListener('change', () => {
      const s = inp.value.trim();
      if (!s) {
        adapter.set(field, null);
        adapter.applyCss(field, '');
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(inp, field, adapter, '');
        return;
      }
      let n = parseFloat(s);
      if (isNaN(n)) {
        adapter.set(field, null);
        adapter.applyCss(field, '');
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(inp, field, adapter, '');
        return;
      }
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      adapter.set(field, n);
      adapter.applyCss(field, n);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(inp, field, adapter, n);
    });
    return inp;
  }
  if (field.type === 'rangeNumber') {
    const currentNumber = _fsParseBoundedNumber(cur, field, _fsParseBoundedNumber(field.fallback, field, 0));
    const wrap = document.createElement('span');
    wrap.className = 'gb-fs-range-number';

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'gb-fs-range-number__slider';
    if (field.min !== undefined) range.min = String(field.min);
    if (field.max !== undefined) range.max = String(field.max);
    if (field.step !== undefined) range.step = String(field.step);
    range.value = String(currentNumber);
    range.title = field.label;
    _fsSetControlE2e(range, field, rowLabel, 'range');

    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'gb-fmt-num gb-fs-range-number__input';
    if (field.min !== undefined) num.min = String(field.min);
    if (field.max !== undefined) num.max = String(field.max);
    if (field.step !== undefined) num.step = String(field.step);
    num.value = String(currentNumber);
    num.title = field.label;
    _fsSetControlE2e(num, field, rowLabel, 'number');

    const unit = document.createElement('span');
    unit.className = 'gb-fmt-label';
    unit.textContent = field.unit || '';

    const commit = (raw) => {
      const n = _fsParseBoundedNumber(raw, field, currentNumber);
      range.value = String(n);
      num.value = String(n);
      const nextValue = String(n) + (field.unit || '');
      adapter.set(field, nextValue);
      adapter.applyCss(field, nextValue);
      if (typeof globalThis.GBUI?.refreshRangeFill === 'function') globalThis.GBUI.refreshRangeFill(range);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(wrap, field, adapter, nextValue);
    };

    range.addEventListener('input', () => commit(range.value));
    num.addEventListener('input', () => {
      const n = parseFloat(String(num.value ?? '').replace(/px$/i, '').trim());
      if (!Number.isFinite(n)) return;
      if (field.min !== undefined && n < field.min) return;
      if (field.max !== undefined && n > field.max) return;
      range.value = String(n);
      if (typeof globalThis.GBUI?.refreshRangeFill === 'function') globalThis.GBUI.refreshRangeFill(range);
    });
    num.addEventListener('change', () => commit(num.value));
    if (typeof globalThis.GBUI?.refreshRangeFill === 'function') globalThis.GBUI.refreshRangeFill(range);

    wrap.append(range, num);
    if (unit.textContent) wrap.appendChild(unit);
    return wrap;
  }
  if (field.type === 'text' || field.type === 'pxtext') {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'gb-fmt-text';
    // フォント名等は長め、px 値等は短めに
    inp.style.width = field.type === 'text' ? '120px' : '60px';
    inp.value = cur || '';
    inp.placeholder = field.type === 'pxtext' ? '2px' : '—';
    inp.title = field.label;
    _fsSetControlE2e(inp, field, rowLabel, field.type);
    inp.addEventListener('change', () => {
      const s = inp.value.trim();
      adapter.set(field, s || '');
      adapter.applyCss(field, s || '');
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(inp, field, adapter, s || '');
    });
    return inp;
  }
  return document.createElement('span');
}
