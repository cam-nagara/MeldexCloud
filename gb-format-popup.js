/* ==============================
   gb-format-popup.js
   書式設定ポップアップ共通ヘルパー

   対象:
   - シナリオ（scriptnote）のセル書式設定（_showCellStylePopup / _showColBulkPopup）
   - ノート右クリックの書式設定
   - ボードのカード／ラインのスタイル設定
   - その他、色＋書式の編集を要する UI

   詳細: app/docs/format-popup-ui-unification-plan.md
   ============================== */

(function () {
  'use strict';

  const POPUP_CLASS = 'gb-fmt-popup';

  // 透明背景のチェック柄（背景色未設定時）
  const CHECKER_BG = {
    backgroundImage:
      'linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),' +
      'linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%)',
    backgroundSize: '6px 6px',
    backgroundPosition: '0 0,3px 3px',
  };

  const ALIGN_H_OPTS = [
    { v: '', l: '自動' }, { v: 'left', l: '左' }, { v: 'center', l: '中' }, { v: 'right', l: '右' },
  ];
  const ALIGN_V_OPTS = [
    { v: '', l: '自動' }, { v: 'top', l: '上' }, { v: 'middle', l: '中' }, { v: 'bottom', l: '下' },
  ];
  // 縦書き（vertical-rl）では text-align は上下方向（left=上）、valign は左右方向（top=右）に
  // 対応するため、保存値はそのままに表記だけを縦書き向けへ差し替える
  const ALIGN_H_OPTS_VERTICAL = [
    { v: '', l: '自動' }, { v: 'left', l: '上' }, { v: 'center', l: '中' }, { v: 'right', l: '下' },
  ];
  const ALIGN_V_OPTS_VERTICAL = [
    { v: '', l: '自動' }, { v: 'top', l: '右' }, { v: 'middle', l: '中' }, { v: 'bottom', l: '左' },
  ];
  const OVERFLOW_OPTS = [
    { v: '', l: '自動' }, { v: 'wrap', l: '折返' }, { v: 'overflow', l: '溢出' }, { v: 'clip', l: '切詰' },
  ];

  const DEFAULT_FIELDS = [
    'textColor', 'fontSize', 'fontFamily',
    'bold', 'italic', 'textStrokeColor', 'textStrokeWidth',
    'bgColor', 'leftAccent', 'underline', 'accentColor',
    'textBefore', 'textAfter', 'textAlign', 'textValign', 'textOverflow',
  ];

  function _commitFormatInput(input) {
    if (input && typeof input._gbFmtCommit === 'function') input._gbFmtCommit();
  }

  function _commitPendingFormatInputs(root) {
    root?.querySelectorAll?.('input, textarea').forEach(_commitFormatInput);
  }

  function _removeFormatPopup(popup, options) {
    if (!popup) return;
    if (typeof popup._gbFmtCleanup === 'function') popup._gbFmtCleanup();
    if (!(options && options.skipCommit)) _commitPendingFormatInputs(popup);
    popup.remove?.();
  }

  function closeAllFormatPopups() {
    document.querySelectorAll('.' + POPUP_CLASS).forEach((el) => _removeFormatPopup(el));
  }

  function closeAllPalettePopups() {
    document.querySelectorAll('.gb-palette-popup').forEach((el) => el.remove());
  }

  function _isTransparentColor(color) {
    const raw = String(color || '').replace(/\s+/g, '').toLowerCase();
    return !raw
      || raw === 'transparent'
      || raw === 'rgba(0,0,0,0)'
      || raw === 'rgba(0,0,0,0.0)'
      || /^rgba\([^,]+,[^,]+,[^,]+,0(?:\.0+)?\)$/.test(raw);
  }

  function _setSwatchBg(sw, color) {
    // 透明（'transparent' / 空文字 / 'rgba(0,0,0,0)'）はどちらも
    // 「色が付いていない」ことを示すためチェッカー柄で表現する。
    if (!_isTransparentColor(color)) {
      sw.style.background = color;
      sw.style.backgroundSize = '';
      sw.style.backgroundPosition = '';
      sw.style.backgroundImage = '';
    } else {
      sw.style.background = '';
      Object.assign(sw.style, CHECKER_BG);
    }
  }

  function _setTextSwatchBg(btn, bgColor) {
    btn.style.background = _isTransparentColor(bgColor) ? 'var(--bg)' : bgColor;
  }

  function _lucideOr(name, size, fallback) {
    if (typeof lucide === 'function') {
      try {
        const svg = lucide(name, size);
        if (svg) return svg;
      } catch (e) {}
    }
    return fallback || '';
  }

  function _fontFamilyOptions() {
    if (typeof getFontFamilyOptionItems === 'function') {
      try { return getFontFamilyOptionItems(); } catch {}
    }
    return [
      { v: '', l: '共通フォント', style: 'font-family:inherit;' },
      { v: 'sans-serif', l: 'Sans Serif', style: 'font-family:sans-serif;' },
      { v: 'serif', l: 'Serif', style: 'font-family:serif;' },
      { v: 'monospace', l: 'Monospace', style: 'font-family:monospace;' },
    ];
  }

  function _bindPressAction(el, handler) {
    if (!el || typeof handler !== 'function') return el;
    let touchHandled = false;
    const run = (ev) => {
      if (el.disabled) return;
      handler(ev);
    };
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse') return;
      ev.preventDefault();
      ev.stopPropagation();
      touchHandled = true;
      run(ev);
    });
    el.addEventListener('click', (ev) => {
      if (touchHandled) {
        touchHandled = false;
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      run(ev);
    });
    return el;
  }

  function _colorWithPreservedAlpha(currentColor, nextColor, options) {
    const next = nextColor || '';
    if (options?.bgType !== 'rgba') return next;
    if (!next || next === 'transparent' || !/^#[0-9a-f]{3,6}$/i.test(next)) return next;
    const parsed = typeof parseColorToHexAlpha === 'function' ? parseColorToHexAlpha(currentColor) : null;
    const alpha = Number.isFinite(parsed?.alpha) ? parsed.alpha : 1;
    if (alpha > 0 && alpha < 1 && typeof hexAlphaToRgba === 'function') return hexAlphaToRgba(next, alpha);
    return next;
  }

  function _makeSwatchBg(title, initialColor, onPick, options = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-swatch gb-fmt-swatch-bg';
    btn.title = title || '背景色';
    let currentColor = initialColor || '';
    _setSwatchBg(btn, currentColor);
    _bindPressAction(btn, () => {
      if (typeof openColorPalette !== 'function') return;
      openColorPalette(btn, currentColor || '', (color) => {
        // 透明を選んだ場合は 'transparent' を伝播させ、各項目の bg を明示的に
        // 透過へ切り替える。空文字にすると CSS 変数の宣言が削除され、
        // テーマ既定値に戻ってしまうため透明指定が反映されなくなる。
        const resolved = _colorWithPreservedAlpha(currentColor, color, options);
        currentColor = resolved;
        _setSwatchBg(btn, resolved);
        onPick(resolved);
      });
    });
    return btn;
  }

  function _makeSwatchText(title, initialColor, iconName, onPick, bgColor) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-swatch gb-fmt-swatch-fg';
    btn.title = title || '文字色';
    btn.innerHTML = _lucideOr(iconName || 'type', 14, 'T');
    let currentColor = initialColor || '';
    btn.style.color = currentColor || 'var(--fg)';
    _setTextSwatchBg(btn, bgColor);
    _bindPressAction(btn, () => {
      if (typeof openColorPalette !== 'function') return;
      openColorPalette(btn, currentColor || '', (color) => {
        const resolved = color === 'transparent' ? '' : color;
        currentColor = resolved;
        btn.style.color = resolved || 'var(--fg)';
        onPick(resolved);
      });
    });
    return btn;
  }

  function _makeToggleBtn(html, title, activeInit, onToggle) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-btn' + (activeInit ? ' active' : '');
    btn.innerHTML = html;
    btn.title = title;
    _bindPressAction(btn, () => {
      const nextActive = !btn.classList.contains('active');
      btn.classList.toggle('active', nextActive);
      onToggle(nextActive);
    });
    return btn;
  }

  const WIDTH_CLASS_VALUES = new Set([36, 44, 54, 58, 70, 76]);

  function _applyWidthClass(el, baseClass, width) {
    if (!el || !width) return;
    const raw = String(width).trim();
    const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i);
    if (match) {
      const numeric = parseFloat(match[1]);
      const rounded = Math.round(numeric);
      if (Math.abs(numeric - rounded) < 0.01 && WIDTH_CLASS_VALUES.has(rounded)) {
        el.classList.add(baseClass + '--w' + rounded);
        return;
      }
    }
    el.style.width = (typeof width === 'number' ? width + 'px' : width);
  }

  function _makeNumInput(title, value, onChange, opts) {
    const minV = opts && opts.min != null ? opts.min : 8;
    const maxV = opts && opts.max != null ? opts.max : 48;
    const width = opts && opts.width;
    const placeholder = opts && opts.placeholder != null ? opts.placeholder : 'px';
    const allowEmpty = !(opts && opts.allowEmpty === false);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = String(minV);
    inp.max = String(maxV);
    inp.placeholder = placeholder;
    inp.title = title || 'フォントサイズ';
    inp.className = 'gb-fmt-num';
    _applyWidthClass(inp, 'gb-fmt-num', width);
    if (value !== '' && value != null) inp.value = value;
    inp.defaultValue = inp.value;
    inp._gbFmtCommittedValue = inp.value;
    const commit = () => {
      if (inp.value === '') {
        if (allowEmpty) { onChange(null); }
        else { onChange(Math.max(minV, Math.min(maxV, parseInt(inp.defaultValue, 10) || minV))); }
      } else {
        const parsed = parseInt(inp.value, 10);
        const fallback = parseInt(inp.defaultValue, 10);
        const raw = Number.isFinite(parsed) ? parsed : (Number.isFinite(fallback) ? fallback : minV);
        const v = Math.max(minV, Math.min(maxV, raw));
        onChange(v);
      }
      inp._gbFmtCommittedValue = inp.value;
    };
    inp._gbFmtCommit = () => {
      if (inp.value === inp._gbFmtCommittedValue) return;
      commit();
    };
    inp.addEventListener('change', () => inp._gbFmtCommit());
    return inp;
  }

  function _isUnset(value) {
    return value === '' || value == null;
  }

  function _computedPxNumber(anchorEl, prop, fallback) {
    if (!anchorEl || anchorEl.nodeType !== 1) return fallback;
    try {
      const n = parseFloat(getComputedStyle(anchorEl)[prop] || '');
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
    } catch {
      return fallback;
    }
  }

  function _fillCurrentNumberDefaults(anchorEl, values, fields) {
    if (fields.has('fontSize') && _isUnset(values.fontSize)) {
      values.fontSize = _computedPxNumber(anchorEl, 'fontSize', values.fontSize);
    }
    if (fields.has('textStrokeWidth') && _isUnset(values.textStrokeWidth)) {
      values.textStrokeWidth = _computedPxNumber(anchorEl, 'webkitTextStrokeWidth', 0);
    }
  }

  function _makeLabel(text, className) {
    const el = document.createElement('span');
    el.className = 'gb-fmt-label' + (className ? ' ' + className : '');
    el.textContent = text;
    return el;
  }

  function _makeGroup(children) {
    const grp = document.createElement('span');
    grp.className = 'gb-fmt-popup-group';
    children.forEach((c) => grp.appendChild(c));
    return grp;
  }

  function _makeTextInput(value, placeholder, onChange) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'gb-fmt-text';
    if (value != null) inp.value = value;
    if (placeholder) inp.placeholder = placeholder;
    inp._gbFmtCommittedValue = inp.value;
    inp._gbFmtCommit = () => {
      if (inp.value === inp._gbFmtCommittedValue) return;
      inp._gbFmtCommittedValue = inp.value;
      onChange(inp.value);
    };
    inp.addEventListener('change', () => inp._gbFmtCommit());
    return inp;
  }

  function _makeSelect(opts, value, onChange) {
    const sel = document.createElement('select');
    sel.className = 'gb-fmt-sel';
    sel._gbFmtSetOptions = (items, selectedValue) => {
      sel._gbFmtSelectedValue = selectedValue == null ? '' : selectedValue;
      sel.innerHTML = '';
      let currentGroup = null;
      let currentContainer = sel;
      let hasSelectedValue = false;
      items.forEach((o) => {
        const grp = o.group || null;
        if (grp !== currentGroup) {
          if (grp) {
            const og = document.createElement('optgroup');
            og.label = grp;
            sel.appendChild(og);
            currentContainer = og;
          } else {
            currentContainer = sel;
          }
          currentGroup = grp;
        }
        const opt = document.createElement('option');
        opt.value = o.v;
        opt.textContent = o.l;
        if (o.style) opt.setAttribute('style', o.style);
        if (o.title) opt.title = o.title;
        if (selectedValue === o.v || (!selectedValue && !o.v)) {
          opt.selected = true;
          hasSelectedValue = true;
        }
        currentContainer.appendChild(opt);
      });
      if (selectedValue && !hasSelectedValue) {
        const currentOption = document.createElement('option');
        currentOption.value = selectedValue;
        currentOption.textContent = `${selectedValue}（現在の設定）`;
        currentOption.selected = true;
        sel.appendChild(currentOption);
      }
    };
    sel._gbFmtSetOptions(opts, value);
    sel.addEventListener('change', () => {
      sel._gbFmtSelectedValue = sel.value;
      onChange(sel.value);
    });
    return sel;
  }

  /**
   * 書式設定ポップアップを開く
   *
   * @param {HTMLElement} anchorEl アンカー要素（position 基準）
   * @param {Object} options
   * @param {Object} [options.values] 現在値
   *   bgColor, textColor, fontWeight, fontStyle, fontSize, fontFamily,
   *   textStrokeColor, textStrokeWidth, leftAccent, underline, accentColor,
   *   borderColor, borderWidth, caretColor, caretWidth,
   *   textBefore, textAfter, textAlign, textValign, textOverflow,
   *   underline, strike
   * @param {string[]} [options.fields] 表示するフィールド（省略時は全項目）
   * @param {(prop: string, value: any, popup: HTMLElement) => void} options.onChange
   *   値変更時コールバック。prop: 'bgColor'/'textColor'/'fontWeight'/'fontStyle'/
   *   'fontSize'/'fontFamily'/'textStrokeColor'/'textStrokeWidth'/
   *   'leftAccent'/'accentColor'/'borderColor'/'borderWidth'/'caretColor'/'caretWidth'/
   *   'textBefore'/'textAfter'/'textAlign'/'textValign'/'textOverflow'/'underline'/'strike'
   * @param {() => void} [options.onReset] リセット。省略時はリセットボタン非表示
   * @param {Object} [options.bulk] { enabled, label, onToggle(enabled) } 全行適用トグル
   * @param {HTMLElement[]} [options.extraRowTop] ポップアップ最上段（全行より上）に追加する要素
   * @param {HTMLElement[]} [options.extraRow1] row1 末尾に追加する要素
   * @param {HTMLElement[]} [options.extraRow2] 専用設定の下段に追加する要素
   * @param {HTMLElement[]} [options.extraRow3] row3 末尾に追加する要素
   * @param {HTMLElement[]} [options.extraRow4] row4（リセット行）のリセット直前に追加する要素
   * @param {Object} [options.footerActions] 最下段1行へ右寄せ配置するコピー/切り取り/
   *   貼り付け/閉じる。{ commands?: ('copy'|'cut'|'paste')[], onCommand(command),
   *   onClose?(), closeLabel? }。onClose を渡すと既定の右下floating close button の
   *   代わりにこの行の右端へ閉じるボタンを出す（二重表示防止）。専用のクリップボード行を
   *   個別に作らないための共通化オプション（呼び出し元は既存の位置決め・選択保持・
   *   Escape・外側クリック等をそのまま利用できる）。
   * @param {boolean} [options.closeOnOutside=true] ポップアップ外クリックで閉じる
   * @param {string} [options.className] 追加クラス名（旧命名互換用）
   * @param {boolean} [options.verticalWriting] 縦書き（vertical-rl）対象。textAlign/textValign の
   *   ラベルと選択肢の表記を縦書きの方向（水平⇔垂直、左右⇔上下）へ切り替える。保存値は変えない
   * @returns {HTMLElement} 生成されたポップアップ要素
   */
  function openFormatPopup(anchorEl, options) {
    options = options || {};
    closeAllFormatPopups();

    const values = Object.assign({}, options.values || {});
    const fields = new Set(options.fields || DEFAULT_FIELDS);
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    _fillCurrentNumberDefaults(anchorEl, values, fields);
    const textBgSwatches = [];
    const trackTextBgSwatch = (btn) => {
      if (btn) textBgSwatches.push(btn);
      return btn;
    };
    const refreshTextBgSwatches = () => {
      textBgSwatches.forEach((btn) => _setTextSwatchBg(btn, values.bgColor));
    };

    const popup = document.createElement('div');
    popup.className = POPUP_CLASS + (options.className ? ' ' + options.className : '');
    let outsideCloseHandler = null;
    let escapeCloseHandler = null;
    popup._gbFmtCleanup = () => {
      if (outsideCloseHandler) document.removeEventListener('pointerdown', outsideCloseHandler, true);
      if (escapeCloseHandler) document.removeEventListener('keydown', escapeCloseHandler, true);
      outsideCloseHandler = null;
      escapeCloseHandler = null;
      popup._gbFmtCleanup = null;
    };

    const emit = (prop, value) => {
      values[prop] = value;
      if (prop === 'bgColor') refreshTextBgSwatches();
      onChange(prop, value, popup);
    };

    // --- Row Top: 最上段の追加行（ルビ入力など、書式行より上に置きたい要素）---
    const topRowItems = Array.isArray(options.extraRowTop) ? options.extraRowTop.filter(Boolean) : [];
    if (topRowItems.length) {
      const rowTop = document.createElement('div');
      rowTop.className = 'gb-fmt-popup-row gb-fmt-popup-row--top gb-fmt-popup-row--bordered';
      topRowItems.forEach((el) => rowTop.appendChild(el));
      popup.appendChild(rowTop);
    }

    // --- Row 0: bulk（全行適用）---
    if (options.bulk && options.bulk.enabled != null) {
      const row0 = document.createElement('div');
      row0.className = 'gb-fmt-popup-row gb-fmt-popup-row--bordered';
      const label = document.createElement('label');
      label.className = 'gb-fmt-popup-group';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!options.bulk.enabled;
      cb.addEventListener('change', () => {
        if (typeof options.bulk.onToggle === 'function') options.bulk.onToggle(cb.checked);
      });
      const labelText = document.createElement('span');
      labelText.className = 'gb-fmt-label';
      labelText.textContent = options.bulk.label || '全行に適用';
      label.append(cb, labelText);
      row0.appendChild(label);
      popup.appendChild(row0);
    }

    // --- Row 1: テキスト設定 ---
    const row1 = document.createElement('div');
    row1.className = 'gb-fmt-popup-row gb-fmt-popup-row--text';

    if (fields.has('textColor')) {
      row1.appendChild(trackTextBgSwatch(_makeSwatchText('文字色', values.textColor, 'type', (c) => emit('textColor', c), values.bgColor)));
    }
    if (fields.has('caretColor')) {
      row1.appendChild(trackTextBgSwatch(_makeSwatchText('カーソル色', values.caretColor, 'textCursorInput', (c) => emit('caretColor', c), values.bgColor)));
    }
    if (fields.has('borderColor')) {
      row1.appendChild(_makeSwatchBg('線色', values.borderColor, (c) => emit('borderColor', c)));
    }
    if (fields.has('fontSize')) {
      const szInput = _makeNumInput('フォントサイズ', values.fontSize, (v) => emit('fontSize', v), { min: 8, max: 96, width: 58 });
      row1.appendChild(_makeGroup([szInput, _makeLabel('px')]));
    }
    if (fields.has('borderWidth')) {
      const wInput = _makeNumInput('線の太さ', values.borderWidth, (v) => emit('borderWidth', v), { min: 0, max: 20, width: 54 });
      row1.appendChild(_makeGroup([wInput, _makeLabel('px')]));
    }
    if (fields.has('caretWidth')) {
      const cInput = _makeNumInput('カーソル太さ', values.caretWidth, (v) => emit('caretWidth', v), { min: 1, max: 20, width: 54 });
      row1.appendChild(_makeGroup([cInput, _makeLabel('px')]));
    }
    if (fields.has('fontFamily')) {
      const sel = _makeSelect(_fontFamilyOptions(), values.fontFamily || '', (v) => emit('fontFamily', v));
      sel.title = 'フォント';
      sel.classList.add('gb-fmt-sel--font');
      const refreshFontOptions = () => sel._gbFmtSetOptions?.(_fontFamilyOptions(), sel._gbFmtSelectedValue);
      window.addEventListener('meldex:font-catalog-updated', refreshFontOptions);
      const previousCleanup = popup._gbFmtCleanup;
      popup._gbFmtCleanup = () => {
        window.removeEventListener('meldex:font-catalog-updated', refreshFontOptions);
        previousCleanup?.();
      };
      row1.appendChild(sel);
    }

    if (Array.isArray(options.extraRow1)) options.extraRow1.forEach((el) => el && row1.appendChild(el));
    if (row1.childElementCount) popup.appendChild(row1);

    // --- Row 2: テキスト装飾 ---
    const row2 = document.createElement('div');
    row2.className = 'gb-fmt-popup-row gb-fmt-popup-row--text-decoration';

    if (fields.has('bold')) {
      row2.appendChild(_makeToggleBtn('<b>B</b>', '太字', values.fontWeight === 'bold', (on) => emit('fontWeight', on ? 'bold' : '')));
    }
    if (fields.has('italic')) {
      row2.appendChild(_makeToggleBtn('<i>I</i>', '斜体', values.fontStyle === 'italic', (on) => emit('fontStyle', on ? 'italic' : '')));
    }
    if (fields.has('textStrokeColor')) {
      row2.appendChild(trackTextBgSwatch(_makeSwatchText('文字フチ色', values.textStrokeColor, 'typeOutline', (c) => emit('textStrokeColor', c), values.bgColor)));
    }
    if (fields.has('textStrokeWidth')) {
      const swInput = _makeNumInput('文字フチ幅', values.textStrokeWidth, (v) => emit('textStrokeWidth', v), { min: 0, max: 12, width: 54 });
      row2.appendChild(_makeGroup([swInput, _makeLabel('px')]));
    }
    if (fields.has('strike')) {
      row2.appendChild(_makeToggleBtn('<s>S</s>', '取消線', !!values.strike, (on) => emit('strike', on)));
    }

    if (row2.childElementCount) popup.appendChild(row2);

    // --- Row 3: 装飾設定 ---
    const row3 = document.createElement('div');
    row3.className = 'gb-fmt-popup-row gb-fmt-popup-row--decoration';

    if (fields.has('bgColor')) {
      row3.appendChild(_makeSwatchBg('背景色', values.bgColor, (c) => emit('bgColor', c), { bgType: options.bgColorType || '' }));
    }
    if (fields.has('leftAccent')) {
      row3.appendChild(_makeToggleBtn(_lucideOr('panelLeft', 14, '|'), '左アクセントバー', !!values.leftAccent, (on) => emit('leftAccent', on)));
    }
    if (fields.has('underline')) {
      row3.appendChild(_makeToggleBtn(_lucideOr('underline', 14, '<u>U</u>'), '行の下線', !!values.underline, (on) => emit('underline', on)));
    }
    if (fields.has('accentColor')) {
      row3.appendChild(_makeSwatchBg('アクセントカラー', values.accentColor, (c) => emit('accentColor', c)));
    }

    if (Array.isArray(options.extraRow3)) options.extraRow3.forEach((el) => el && row3.appendChild(el));
    if (row3.childElementCount) popup.appendChild(row3);

    // --- Row 4: タイプ管理固有設定 + リセット ---
    const hasRow4Fields = ['textBefore', 'textAfter', 'textAlign', 'textValign', 'textOverflow']
      .some((f) => fields.has(f));
    const row4Extra = Array.isArray(options.extraRow2) ? options.extraRow2.filter(Boolean) : [];
    const hasRow4Extra = row4Extra.length > 0;
    const row4Buttons = Array.isArray(options.extraRow4) ? options.extraRow4.filter(Boolean) : [];
    const hasReset = typeof options.onReset === 'function';
    if (hasRow4Fields || hasReset || row4Buttons.length) {
      const row4 = document.createElement('div');
      row4.className = 'gb-fmt-popup-row gb-fmt-popup-row--wrap gb-fmt-popup-row--specific';

      if (fields.has('textBefore')) {
        const lbl = _makeLabel('前');
        const inp = _makeTextInput(values.textBefore || '', '「', (v) => emit('textBefore', v));
        lbl.title = inp.title = 'テキスト列の先頭に表示する文字を設定します';
        row4.appendChild(_makeGroup([lbl, inp]));
      }
      if (fields.has('textAfter')) {
        const lbl = _makeLabel('後');
        const inp = _makeTextInput(values.textAfter || '', '」', (v) => emit('textAfter', v));
        lbl.title = inp.title = 'テキスト列の末尾に表示する文字を設定します';
        row4.appendChild(_makeGroup([lbl, inp]));
      }
      const verticalWriting = !!options.verticalWriting;
      if (fields.has('textAlign')) {
        const lbl = _makeLabel(verticalWriting ? '垂直' : '水平');
        const sel = _makeSelect(verticalWriting ? ALIGN_H_OPTS_VERTICAL : ALIGN_H_OPTS, values.textAlign || '', (v) => emit('textAlign', v));
        lbl.title = sel.title = verticalWriting ? 'セル内の文字を上下方向に揃えます' : 'セル内の文字を左右方向に揃えます';
        row4.appendChild(_makeGroup([lbl, sel]));
      }
      if (fields.has('textValign')) {
        const lbl = _makeLabel(verticalWriting ? '水平' : '垂直');
        const sel = _makeSelect(verticalWriting ? ALIGN_V_OPTS_VERTICAL : ALIGN_V_OPTS, values.textValign || '', (v) => emit('textValign', v));
        lbl.title = sel.title = verticalWriting ? 'セル内の文字を左右方向に揃えます' : 'セル内の文字を上下方向に揃えます';
        row4.appendChild(_makeGroup([lbl, sel]));
      }
      if (fields.has('textOverflow')) {
        const lbl = _makeLabel('折返');
        const sel = _makeSelect(OVERFLOW_OPTS, values.textOverflow || '', (v) => emit('textOverflow', v));
        lbl.title = sel.title = '長いテキストを折り返すか、はみ出し表示や切り詰めにするかを選びます';
        row4.appendChild(_makeGroup([lbl, sel]));
      }

      row4Buttons.forEach((el) => row4.appendChild(el));

      if (hasReset) {
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'gb-fmt-reset';
        resetBtn.textContent = 'リセット';
        resetBtn.title = '書式を初期状態に戻す';
        _bindPressAction(resetBtn, () => {
          closeAllPalettePopups();
          options.onReset();
          _removeFormatPopup(popup, { skipCommit: true });
        });
        row4.appendChild(resetBtn);
      }

      popup.appendChild(row4);
    }
    if (hasRow4Extra) {
      const row5 = document.createElement('div');
      row5.className = 'gb-fmt-popup-row gb-fmt-popup-row--count gb-fmt-popup-row--specific';
      row4Extra.forEach((el) => row5.appendChild(el));
      popup.appendChild(row5);
    }

    // --- Row footer: コピー・切り取り・貼り付け・閉じるを最下段1行へ右寄せ配置 ---
    // 計画書2026-08-04版§2.4: 専用のクリップボード行を各呼び出し元が個別に作らず、
    // ここで共通化する。footerActions.onClose を渡した場合はここで閉じるボタンを
    // 出すため、右下floatingの既定close button（下のattachMeldexDropdownCloseButton）
    // は二重表示を避けるため出さない。footerActions未指定時は従来どおり。
    const footerActions = options.footerActions || null;
    let footerHasClose = false;
    if (footerActions) {
      const commands = Array.isArray(footerActions.commands) ? footerActions.commands : ['copy', 'cut', 'paste'];
      const commandMeta = {
        copy: { icon: 'copy', label: 'コピー' },
        cut: { icon: 'scissors', label: '切り取り' },
        paste: { icon: 'clipboardPaste', label: '貼り付け' },
      };
      const footerRow = document.createElement('div');
      footerRow.className = 'gb-fmt-popup-row gb-fmt-footer-actions-row';
      if (typeof footerActions.onCommand === 'function') {
        commands.forEach((cmd) => {
          const meta = commandMeta[cmd];
          if (!meta) return;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'gb-fmt-style-copy gb-fmt-footer-action';
          btn.title = meta.label;
          btn.setAttribute('aria-label', meta.label);
          btn.dataset.footerAction = cmd;
          btn.innerHTML = _lucideOr(meta.icon, 14, meta.label);
          _bindPressAction(btn, () => footerActions.onCommand(cmd));
          footerRow.appendChild(btn);
        });
      }
      if (typeof footerActions.onClose === 'function') {
        footerHasClose = true;
        const closeLabel = footerActions.closeLabel || '閉じる';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gb-fmt-style-copy gb-fmt-footer-close';
        closeBtn.title = closeLabel;
        closeBtn.setAttribute('aria-label', closeLabel);
        closeBtn.dataset.footerAction = 'close';
        closeBtn.innerHTML = _lucideOr('x', 14, closeLabel);
        _bindPressAction(closeBtn, () => footerActions.onClose());
        footerRow.appendChild(closeBtn);
      }
      if (footerRow.childElementCount) popup.appendChild(footerRow);
    }

    if (options.closeButton !== false && !footerHasClose && typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(popup, {
        trigger: () => options.focusTarget || anchorEl,
        close: () => _removeFormatPopup(popup),
      });
    }

    // --- マウント + 位置決め ---
    document.body.appendChild(popup);
    const anchor = options.positionAnchor || anchorEl;
    if (typeof positionPopup === 'function' && anchor) {
      positionPopup(popup, anchor.getBoundingClientRect(), {
        avoidRect: options.avoidRect || null,
        gap: options.gap,
        prefer: options.prefer,
      });
    }

    if (options.closeOnEscape !== false) {
      escapeCloseHandler = (ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        closeAllPalettePopups();
        _removeFormatPopup(popup);
      };
      document.addEventListener('keydown', escapeCloseHandler, true);
    }

    // --- 外クリックで閉じる ---
    if (options.closeOnOutside !== false) {
      setTimeout(() => {
        if (!popup.isConnected) return;
        outsideCloseHandler = (ev) => {
          if (!popup.contains(ev.target) && !ev.target.closest?.('.gb-palette-popup')) {
            _removeFormatPopup(popup);
          }
        };
        document.addEventListener('pointerdown', outsideCloseHandler, true);
      }, 0);
    }

    return popup;
  }

  // --- インライン用ビルダー API ---
  // モーダル内などポップアップ以外の場所で、共通の書式UI部品を組み立てるための公開API。
  // 計画書 §2-4 の「共通ヘルパー」をインライン用途向けに再エクスポート。
  //
  // 使い方:
  //   const row = gbFmt.makeRow();
  //   row.appendChild(gbFmt.makeSwatchBg({ title: '背景色', color: v.bgColor, onPick: (c) => ... }));
  //   row.appendChild(gbFmt.makeToggle({ html: '<b>B</b>', title: '太字', active: v.fontBold, onToggle: (on) => ... }));
  //   container.appendChild(row);
  function _makeTextInputEx(opts) {
    opts = opts || {};
    const inp = _makeTextInput(opts.value, opts.placeholder, opts.onChange || (() => {}));
    _applyWidthClass(inp, 'gb-fmt-text', opts.width);
    if (opts.title) inp.title = opts.title;
    return inp;
  }

  function _makeCheckbox(opts) {
    opts = opts || {};
    const label = document.createElement('label');
    label.className = 'gb-fmt-popup-group gb-fmt-check';
    if (opts.title) label.title = opts.title;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!opts.checked;
    cb.addEventListener('change', () => { if (opts.onChange) opts.onChange(cb.checked); });
    const text = document.createElement('span');
    text.className = 'gb-fmt-label';
    text.textContent = opts.text || '';
    label.append(cb, text);
    return label;
  }

  function _makeRow(opts) {
    opts = opts || {};
    const row = document.createElement('div');
    let cls = 'gb-fmt-popup-row';
    if (opts.wrap) cls += ' gb-fmt-popup-row--wrap';
    if (opts.bordered) cls += ' gb-fmt-popup-row--bordered';
    if (opts.className) cls += ' ' + opts.className;
    row.className = cls;
    return row;
  }

  function _makeResetBtn(opts) {
    opts = opts || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-reset';
    btn.textContent = opts.text || 'リセット';
    btn.title = opts.title || '書式を初期状態に戻す';
    _bindPressAction(btn, () => { if (opts.onClick) opts.onClick(); });
    return btn;
  }

  window.gbFmt = {
    makeSwatchBg(opts) {
      opts = opts || {};
      return _makeSwatchBg(opts.title, opts.color, opts.onPick || (() => {}), { bgType: opts.bgType || '' });
    },
    makeSwatchText(opts) {
      opts = opts || {};
      return _makeSwatchText(opts.title, opts.color, opts.iconName || 'type', opts.onPick || (() => {}), opts.bgColor || '');
    },
    makeToggle(opts) {
      opts = opts || {};
      return _makeToggleBtn(opts.html || '', opts.title || '', !!opts.active, opts.onToggle || (() => {}));
    },
    makeNumInput(opts) {
      opts = opts || {};
      return _makeNumInput(opts.title, opts.value, opts.onChange || (() => {}), {
        min: opts.min,
        max: opts.max,
        width: opts.width,
        placeholder: opts.placeholder,
        allowEmpty: opts.allowEmpty,
      });
    },
    makeTextInput: _makeTextInputEx,
    makeSelect(opts) {
      opts = opts || {};
      return _makeSelect(opts.opts || [], opts.value, opts.onChange || (() => {}));
    },
    makeLabel(text, className) { return _makeLabel(text, className); },
    makeGroup(children) { return _makeGroup(children || []); },
    makeCheckbox: _makeCheckbox,
    makeRow: _makeRow,
    makeResetBtn: _makeResetBtn,
  };

  window.openFormatPopup = openFormatPopup;
  window.closeAllFormatPopups = closeAllFormatPopups;
  window.closeAllPalettePopups = closeAllPalettePopups;
})();
