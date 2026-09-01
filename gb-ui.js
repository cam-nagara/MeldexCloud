/* gb-ui.js — Meldex UI Design System component builders (Phase 1+2)
   仕様書: app/docs/ui-design-system-spec.md (v3.x)
   役割: gb-ui.css の共通コンポーネントを「素の DOM 組み立て」抜きで作るためのヘルパー集。
         HTML文字列 + inline style 直書きの根絶 (Phase 6 ガードレール) に向けた前準備。
   依存: gb-ui.css (CSS定義の単一ソース)
   提供: window.GBUI 名前空間
   方針:
     - すべて DOM API (createElement / append) で組み立てる。innerHTML は使わない
     - data 属性や addEventListener でイベントを付与する (onclick属性禁止)
     - 既存コードを破壊しない。新規実装で使う前提
*/
(function() {
  'use strict';
  let modalIdSeq = 0;

  // ============================================================
  // 内部ユーティリティ
  // ============================================================

  function el(tag, opts) {
    const node = document.createElement(tag);
    if (!opts) return node;
    if (opts.cls) {
      const cls = Array.isArray(opts.cls) ? opts.cls : [opts.cls];
      for (const c of cls) if (c) node.classList.add(c);
    }
    if (opts.text != null) node.textContent = opts.text;
    if (opts.title) node.title = opts.title;
    if (opts.attrs) {
      for (const k in opts.attrs) {
        if (opts.attrs[k] != null) node.setAttribute(k, opts.attrs[k]);
      }
    }
    if (opts.dataset) {
      for (const k in opts.dataset) {
        if (opts.dataset[k] != null) node.dataset[k] = opts.dataset[k];
      }
    }
    if (opts.on) {
      for (const ev in opts.on) {
        if (typeof opts.on[ev] === 'function') node.addEventListener(ev, opts.on[ev]);
      }
    }
    if (opts.children) {
      for (const c of opts.children) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function addClassIf(node, cls, cond) {
    if (cond) node.classList.add(cls);
  }

  // ============================================================
  // Button
  // ============================================================
  // opts: { label, icon, size: 'xs'|'sm'|'md'|'lg', variant: 'primary'|'danger'|'quiet'|'ghost',
  //         iconOnly, title, ariaLabel, onClick, disabled, type: 'button'|'submit', extraClass }
  function createButton(opts) {
    opts = opts || {};
    const btn = el('button', {
      cls: ['gb-btn'],
      title: opts.title || '',
      attrs: { type: opts.type || 'button' }
    });
    btn.classList.add('gb-btn-' + (opts.size || 'md'));
    if (opts.variant) btn.classList.add('gb-btn-' + opts.variant);
    if (opts.iconOnly || (opts.icon && !opts.label)) btn.classList.add('gb-btn-icon');
    const buttonLabel = opts.ariaLabel || opts.label || opts.title || '';
    if ((opts.iconOnly || (opts.icon && !opts.label)) && buttonLabel) {
      btn.setAttribute('aria-label', buttonLabel);
    }
    if (opts.extraClass) btn.classList.add(opts.extraClass);
    if (opts.disabled) btn.disabled = true;

    if (opts.icon) {
      // icon は <span class="ico ico-xxx"> または <svg> の DOM、もしくは class 名文字列
      if (typeof opts.icon === 'string') {
        const ic = el('span', { cls: ['ico', 'ico-' + opts.icon] });
        btn.appendChild(ic);
      } else if (opts.icon instanceof Node) {
        btn.appendChild(opts.icon);
      }
    }
    if (opts.label) {
      btn.appendChild(document.createTextNode(opts.label));
    }
    if (typeof opts.onClick === 'function') {
      btn.addEventListener('click', opts.onClick);
    }
    return btn;
  }

  // ============================================================
  // Toolbar
  // ============================================================
  // opts: { modifier: 'app'|'board'|'cal', vertical, items: [Node|null], extraClass }
  function createToolbar(opts) {
    opts = opts || {};
    const tb = el('div', { cls: ['gb-toolbar'] });
    if (opts.modifier) tb.classList.add('gb-toolbar-' + opts.modifier);
    if (opts.vertical) tb.classList.add('gb-toolbar-app--vertical');
    if (opts.extraClass) tb.classList.add(opts.extraClass);
    if (Array.isArray(opts.items)) {
      for (const it of opts.items) {
        if (it == null) continue;
        tb.appendChild(it);
      }
    }
    return tb;
  }

  function createToolbarSep() {
    return el('div', { cls: ['sep'] });
  }

  // items: array of { kind: 'button'|'sep'|'node', ...buttonOpts | nodeOpts.node }
  function createToolbarGroup(items) {
    const frag = document.createDocumentFragment();
    if (!Array.isArray(items)) return frag;
    for (const it of items) {
      if (!it) continue;
      if (it.kind === 'sep') {
        frag.appendChild(createToolbarSep());
      } else if (it.kind === 'node' && it.node instanceof Node) {
        frag.appendChild(it.node);
      } else {
        frag.appendChild(createButton(it));
      }
    }
    return frag;
  }

  // ============================================================
  // Panel Header / Body / Subheader
  // ============================================================
  // opts: { title, actions: Node|Node[], extraClass }
  function createPanelHeader(opts) {
    opts = opts || {};
    const header = el('div', { cls: ['gb-panel-header'] });
    if (opts.extraClass) header.classList.add(opts.extraClass);
    const titleEl = el('div', { cls: ['gb-panel-title'], text: opts.title || '' });
    header.appendChild(titleEl);
    const actions = el('div', { cls: ['gb-panel-actions'] });
    if (opts.actions) {
      const arr = Array.isArray(opts.actions) ? opts.actions : [opts.actions];
      for (const a of arr) if (a instanceof Node) actions.appendChild(a);
    }
    header.appendChild(actions);
    return header;
  }

  function createPanelBody(opts) {
    opts = opts || {};
    const body = el('div', { cls: opts.scroll === false ? ['gb-panel-body'] : ['gb-panel-body-scroll'] });
    if (opts.extraClass) body.classList.add(opts.extraClass);
    if (Array.isArray(opts.children)) {
      for (const c of opts.children) if (c instanceof Node) body.appendChild(c);
    }
    return body;
  }

  function createPanelSubheader(opts) {
    opts = opts || {};
    const sh = el('div', { cls: ['gb-panel-subheader'] });
    if (Array.isArray(opts.items)) {
      for (const it of opts.items) if (it instanceof Node) sh.appendChild(it);
    }
    return sh;
  }

  // ============================================================
  // Section
  // ============================================================
  // opts: { title, desc, boxed, children: Node[] }
  function createSection(opts) {
    opts = opts || {};
    const sec = el('div', { cls: opts.boxed ? ['gb-section', 'gb-section--boxed'] : ['gb-section'] });
    if (opts.title) sec.appendChild(el('div', { cls: ['gb-section-title'], text: opts.title }));
    if (opts.desc) sec.appendChild(el('div', { cls: ['gb-section-desc'], text: opts.desc }));
    if (Array.isArray(opts.children)) {
      for (const c of opts.children) if (c instanceof Node) sec.appendChild(c);
    }
    return sec;
  }

  // ============================================================
  // Field / Input / Select / Textarea
  // ============================================================

  // 縦型: ラベル上、入力下
  // opts: { label, input: Node }
  function createField(opts) {
    opts = opts || {};
    const f = el('div', { cls: ['gb-field'] });
    if (opts.label) f.appendChild(el('label', { cls: ['gb-label'], text: opts.label }));
    if (opts.input instanceof Node) f.appendChild(opts.input);
    return f;
  }

  // 横型行コンテナ
  // opts: { items: Node[] }
  function createFieldRow(opts) {
    opts = opts || {};
    const r = el('div', { cls: ['gb-field-row'] });
    if (Array.isArray(opts.items)) {
      for (const it of opts.items) if (it instanceof Node) r.appendChild(it);
    }
    return r;
  }

  // 横型 1 セット (ラベル + 入力)
  // opts: { label, input: Node }
  function createFieldInline(opts) {
    opts = opts || {};
    const set = el('span', { cls: ['gb-field-inline'] });
    if (opts.label) set.appendChild(el('span', { cls: ['gb-label'], text: opts.label }));
    if (opts.input instanceof Node) set.appendChild(opts.input);
    return set;
  }

  // ラベル + 入力を一発で作る (詳細パネルで多用)
  // opts: { label, kind: 'input'|'input-sm'|'select'|'select-sm'|'textarea'|'num'|'text-sm',
  //         value, options (selectのみ), placeholder, name, onChange, attrs }
  function buildField(opts) {
    opts = opts || {};
    let input;
    switch (opts.kind) {
      case 'select':
      case 'select-sm':
        input = buildSelect(opts);
        break;
      case 'textarea':
      case 'textarea-sm':
        input = buildTextarea(opts);
        break;
      case 'num':
        return buildNumInput(opts);  // num は単独で .gb-num-unit 構造を返す
      case 'text-sm':
        input = buildTextInputSm(opts);
        break;
      case 'input':
      case 'input-sm':
      default:
        input = buildInput(opts);
        break;
    }
    if (opts.inline) {
      return createFieldInline({ label: opts.label, input });
    }
    return createField({ label: opts.label, input });
  }

  function buildInput(opts) {
    const sm = opts.kind === 'input-sm';
    const i = el('input', {
      cls: [sm ? 'gb-input-sm' : 'gb-input'],
      attrs: Object.assign({
        type: opts.type || 'text',
        placeholder: opts.placeholder || '',
        name: opts.name || ''
      }, opts.attrs || {})
    });
    if (opts.value != null) i.value = opts.value;
    if (opts.onChange) i.addEventListener('change', opts.onChange);
    if (opts.onInput) i.addEventListener('input', opts.onInput);
    return i;
  }

  function buildSelect(opts) {
    const sm = opts.kind === 'select-sm';
    const s = el('select', {
      cls: sm ? ['gb-select', 'gb-select-sm'] : ['gb-select'],
      attrs: Object.assign({ name: opts.name || '' }, opts.attrs || {})
    });
    if (Array.isArray(opts.options)) {
      for (const o of opts.options) {
        const obj = o != null && typeof o === 'object' ? o : { value: o, label: o };
        const value = obj.value != null ? obj.value : (obj.label != null ? obj.label : '');
        const label = obj.label != null ? obj.label : String(value);
        const optEl = el('option', { text: label });
        optEl.value = String(value);
        if (opts.value != null && String(opts.value) === String(value)) optEl.selected = true;
        s.appendChild(optEl);
      }
    }
    if (opts.onChange) s.addEventListener('change', opts.onChange);
    return s;
  }

  function buildTextarea(opts) {
    const sm = opts.kind === 'textarea-sm';
    const t = el('textarea', {
      cls: sm ? ['gb-textarea', 'gb-textarea-sm'] : ['gb-textarea'],
      attrs: Object.assign({
        placeholder: opts.placeholder || '',
        name: opts.name || '',
        rows: opts.rows || (sm ? 3 : 4)
      }, opts.attrs || {})
    });
    if (opts.value != null) t.value = opts.value;
    if (opts.onChange) t.addEventListener('change', opts.onChange);
    if (opts.onInput) t.addEventListener('input', opts.onInput);
    return t;
  }

  // 数値入力 + 単位ラベル. opts: { label, value, unit, min, max, step, name, onChange, inline }
  // 戻り値: .gb-field または .gb-field-inline. unit があれば .gb-num-unit でラップ
  function buildNumInput(opts) {
    opts = opts || {};
    const input = el('input', {
      cls: ['gb-num-input'],
      attrs: Object.assign({
        type: 'number',
        name: opts.name || '',
        min: opts.min,
        max: opts.max,
        step: opts.step != null ? opts.step : 1
      }, opts.attrs || {})
    });
    if (opts.value != null) input.value = opts.value;
    if (opts.onChange) input.addEventListener('change', opts.onChange);
    if (opts.onInput) input.addEventListener('input', opts.onInput);

    let inputContainer = input;
    if (opts.unit) {
      inputContainer = el('span', {
        cls: ['gb-num-unit'],
        children: [input, el('span', { cls: ['unit'], text: opts.unit })]
      });
    }
    if (opts.label == null) return inputContainer;
    if (opts.inline) return createFieldInline({ label: opts.label, input: inputContainer });
    return createField({ label: opts.label, input: inputContainer });
  }

  function buildTextInputSm(opts) {
    const i = el('input', {
      cls: ['gb-text-input-sm'],
      attrs: Object.assign({
        type: 'text',
        placeholder: opts.placeholder || '',
        name: opts.name || ''
      }, opts.attrs || {})
    });
    if (opts.value != null) i.value = opts.value;
    if (opts.onChange) i.addEventListener('change', opts.onChange);
    return i;
  }

  // チェックボックス + ラベル
  // opts: { label, checked, name, value, onChange }
  function buildCheck(opts) {
    opts = opts || {};
    const wrap = el('label', { cls: ['gb-check'] });
    const cb = el('input', { attrs: { type: 'checkbox', name: opts.name || '' } });
    if (opts.value != null) cb.value = opts.value;
    if (opts.checked) cb.checked = true;
    if (opts.onChange) cb.addEventListener('change', opts.onChange);
    wrap.appendChild(cb);
    if (opts.label) wrap.appendChild(document.createTextNode(opts.label));
    return wrap;
  }

  // ラジオ
  // opts: { label, name, value, checked, onChange }
  function buildRadio(opts) {
    opts = opts || {};
    const wrap = el('label', { cls: ['gb-check'] });
    const r = el('input', { attrs: { type: 'radio', name: opts.name || '' } });
    if (opts.value != null) r.value = opts.value;
    if (opts.checked) r.checked = true;
    if (opts.onChange) r.addEventListener('change', opts.onChange);
    wrap.appendChild(r);
    if (opts.label) wrap.appendChild(document.createTextNode(opts.label));
    return wrap;
  }

  // チェック並び
  function createCheckRow(items) {
    const r = el('div', { cls: ['gb-check-row'] });
    if (Array.isArray(items)) {
      for (const it of items) if (it instanceof Node) r.appendChild(it);
    }
    return r;
  }

  // ============================================================
  // Color Swatch (Phase 1 緊急実装と対)
  // ============================================================
  // opts: { variant: 'toolbar'|'field'|'inline'|'detail', color, transparent, onClick, title, ariaLabel, isOverridden }
  function createColorSwatch(opts) {
    opts = opts || {};
    const sw = el('button', {
      cls: ['gb-color-swatch'],
      title: opts.title || '',
      attrs: { type: 'button' }
    });
    const label = opts.ariaLabel || opts.title || '';
    if (label) sw.setAttribute('aria-label', label);
    if (opts.variant) sw.classList.add('gb-color-swatch--' + opts.variant);
    if (opts.isOverridden) sw.classList.add('is-overridden');
    applySwatchColor(sw, opts.color, opts.transparent);
    if (typeof opts.onClick === 'function') {
      sw.addEventListener('click', opts.onClick);
    }
    return sw;
  }

  // スウォッチの背景色を更新する共通ヘルパー (仕様書: 共通ヘルパー経由で更新)
  function applySwatchColor(sw, color, transparent) {
    if (!sw) return;
    if (transparent || color === 'transparent' || color == null || color === '') {
      // 透明・未設定: チェッカーパターンで表示
      sw.style.backgroundColor = '';
      sw.style.backgroundImage =
        'linear-gradient(45deg,#888 25%,transparent 25%),' +
        'linear-gradient(-45deg,#888 25%,transparent 25%),' +
        'linear-gradient(45deg,transparent 75%,#888 75%),' +
        'linear-gradient(-45deg,transparent 75%,#888 75%)';
      sw.style.backgroundSize = '6px 6px';
      sw.style.backgroundPosition = '0 0,0 3px,3px -3px,-3px 0';
    } else {
      sw.style.backgroundColor = color;
      sw.style.backgroundImage = '';
      sw.style.backgroundSize = '';
      sw.style.backgroundPosition = '';
    }
  }

  function setSwatchOverridden(sw, isOverridden) {
    if (!sw) return;
    sw.classList.toggle('is-overridden', !!isOverridden);
  }

  // ============================================================
  // Reset Button (オーバーライドリセット)
  // ============================================================
  function createResetBtn(opts) {
    opts = opts || {};
    const btn = el('button', {
      cls: ['gb-reset-btn'],
      title: opts.title || 'リセット',
      text: '\u21BA',  // ↺
      attrs: { type: 'button' }
    });
    btn.setAttribute('aria-label', opts.ariaLabel || opts.title || 'リセット');
    if (typeof opts.onClick === 'function') btn.addEventListener('click', opts.onClick);
    return btn;
  }

  // ============================================================
  // Format Button (.gb-fmt-btn)
  // ============================================================
  // opts: { label, icon, active, title, ariaLabel, onClick }
  function createFmtBtn(opts) {
    opts = opts || {};
    const btn = el('button', {
      cls: ['gb-fmt-btn'],
      title: opts.title || '',
      attrs: { type: 'button' }
    });
    const label = opts.ariaLabel || opts.label || opts.title || '';
    if (label) btn.setAttribute('aria-label', label);
    if (opts.active) {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.setAttribute('aria-pressed', 'false');
    }
    if (opts.icon) {
      if (typeof opts.icon === 'string') {
        btn.appendChild(el('span', { cls: ['ico', 'ico-' + opts.icon] }));
      } else if (opts.icon instanceof Node) {
        btn.appendChild(opts.icon);
      }
    }
    if (opts.label) btn.appendChild(document.createTextNode(opts.label));
    if (typeof opts.onClick === 'function') btn.addEventListener('click', opts.onClick);
    return btn;
  }

  // ============================================================
  // Style Trigger (選択中スタイル表示ボタン)
  // ============================================================
  // opts: { name, meta, previewText, onClick }
  function createStyleTrigger(opts) {
    opts = opts || {};
    const cardPreview = el('span', {
      cls: ['gb-card-preview'],
      text: opts.previewText || 'Aa'
    });
    const previewBox = el('span', {
      cls: ['gb-style-trigger-preview'],
      children: [cardPreview]
    });
    const labelBox = el('span', {
      cls: ['gb-style-trigger-label'],
      children: [
        el('span', { cls: ['name'], text: opts.name || '' }),
        el('span', { cls: ['meta'], text: opts.meta || '' })
      ]
    });
    const caret = el('span', { cls: ['caret'], text: '\u25BE' });
    const btn = el('button', {
      cls: ['gb-style-trigger'],
      attrs: { type: 'button', 'aria-haspopup': 'dialog' },
      children: [previewBox, labelBox, caret]
    });
    const label = opts.ariaLabel || opts.title || opts.name || '';
    if (label) btn.setAttribute('aria-label', label);
    if (typeof opts.onClick === 'function') btn.addEventListener('click', opts.onClick);
    return btn;
  }

  function setStyleTriggerLabel(trigger, name, meta) {
    if (!trigger) return;
    const nameEl = trigger.querySelector('.gb-style-trigger-label > .name');
    const metaEl = trigger.querySelector('.gb-style-trigger-label > .meta');
    if (nameEl) nameEl.textContent = name || '';
    if (metaEl) metaEl.textContent = meta || '';
  }

  // ============================================================
  // Data Table
  // ============================================================
  // opts: { columns: [{ key, label, width }], rows: [obj], actions: Node[],
  //         onRowClick, selectedKey, rowKey: 'id'|fn }
  function createDataTable(opts) {
    opts = opts || {};
    const wrap = el('div', { cls: ['gb-data-table-wrap'] });
    const scroll = el('div', { cls: ['gb-data-table-scroll'] });
    const table = el('table', { cls: ['gb-data-table'] });

    // colgroup で固定幅
    if (Array.isArray(opts.columns) && opts.columns.some(c => c.width)) {
      const colgroup = el('colgroup');
      for (const c of opts.columns) {
        const colEl = el('col');
        if (c.width) colEl.style.width = (typeof c.width === 'number' ? c.width + 'px' : c.width);
        colgroup.appendChild(colEl);
      }
      table.appendChild(colgroup);
    }

    // thead
    if (Array.isArray(opts.columns)) {
      const thead = el('thead');
      const tr = el('tr');
      for (const c of opts.columns) {
        tr.appendChild(el('th', { text: c.label || '' }));
      }
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    // tbody
    const tbody = el('tbody');
    if (Array.isArray(opts.rows)) {
      const keyFn = typeof opts.rowKey === 'function'
        ? opts.rowKey
        : (typeof opts.rowKey === 'string'
            ? (r => r[opts.rowKey])
            : (r => r && r.id));
      for (const row of opts.rows) {
        const tr = el('tr');
        const key = keyFn(row);
        if (key != null) tr.dataset.key = key;
        if (opts.selectedKey != null && String(opts.selectedKey) === String(key)) {
          tr.classList.add('selected');
        }
        for (const c of (opts.columns || [])) {
          const raw = row && row[c.key];
          const td = el('td');
          if (typeof c.render === 'function') {
            const out = c.render(raw, row);
            if (out instanceof Node) td.appendChild(out);
            else if (out != null) td.textContent = String(out);
          } else if (raw instanceof Node) {
            td.appendChild(raw);
          } else if (raw != null) {
            td.textContent = String(raw);
          }
          tr.appendChild(td);
        }
        if (typeof opts.onRowClick === 'function') {
          tr.addEventListener('click', (ev) => opts.onRowClick(row, ev));
          tr.tabIndex = 0;
          tr.setAttribute('role', 'button');
          tr.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            opts.onRowClick(row, ev);
          });
        }
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);
    scroll.appendChild(table);

    if (Array.isArray(opts.actions) && opts.actions.length) {
      const actBar = el('div', { cls: ['gb-data-table-actions'] });
      for (const a of opts.actions) {
        if (a instanceof Node) actBar.appendChild(a);
      }
      scroll.appendChild(actBar);
    }

    wrap.appendChild(scroll);
    return wrap;
  }

  // ============================================================
  // Modal
  // ============================================================
  const MODAL_VARIANTS = new Set(['standard', 'full-bleed', 'mobile-sheet']);
  const MODAL_FOCUSABLE_SELECTOR = [
    '[autofocus]', '[data-initial-focus]', 'button:not([disabled])',
    'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])',
    'a[href]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function _modalFocusTarget(spec, modal) {
    let target = spec;
    if (typeof target === 'function') target = target(modal);
    if (typeof target === 'string') target = modal.querySelector(target);
    if (target?.focus) return target;
    return modal.querySelector(MODAL_FOCUSABLE_SELECTOR) || modal;
  }

  function _focusModalTarget(spec, modal) {
    const target = _modalFocusTarget(spec, modal);
    try { target?.focus?.({ preventScroll: true }); } catch { target?.focus?.(); }
  }

  function _modalCloseReason(value) {
    return value && typeof value === 'object' && typeof value.preventDefault === 'function'
      ? 'programmatic'
      : (String(value || 'programmatic'));
  }

  // 閉鎖アニメーション中のダイアログ（モバイルの下シートは gb-modal-shell が約220ms
  // 遅延removeする）は「最前面」に数えない。数えると、閉じた直後の外側タップ・Escapeが
  // 死んだダイアログにブロックされて無反応になる（2026-08-20 実測）。
  function _isDialogClosingOrHidden(node) {
    return !!node.closest('[aria-hidden="true"], .gb-mobile-dialog-overlay-closing, [data-mobile-dialog-closing="1"]');
  }

  function _isTopmostModal(modal) {
    if (window.GBDialogKeyboard?.topmostDialog) {
      const managedTop = window.GBDialogKeyboard.topmostDialog();
      if (managedTop && managedTop.isConnected && !_isDialogClosingOrHidden(managedTop)) return managedTop === modal;
    }
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'))
      .filter(node => node.isConnected && !node.hidden && !_isDialogClosingOrHidden(node));
    return !dialogs.length || dialogs[dialogs.length - 1] === modal;
  }

  // opts: { title, body: Node|Node[], footer: Node|Node[], variant,
  //         initialFocus, returnFocus, closeButton, closeOnEsc, closeOnOverlay, resizable,
  //         geometryKey, onBeforeClose, onClose, minWidth, extraClass }
  // 戻り値: { overlay, modal, header, body, footer, open(), close(reason) }
  function createModal(opts) {
    opts = opts || {};
    const variant = MODAL_VARIANTS.has(opts.variant) ? opts.variant : 'standard';
    const overlay = el('div', { cls: ['gb-modal-overlay'] });
    overlay.dataset.dialogVariant = variant;
    const modalId = opts.id || ('gb-ui-modal-' + (++modalIdSeq));
    overlay.dataset.dialogId = modalId;
    const titleId = opts.titleId || (modalId + '-title');
    const modal = el('div', {
      cls: ['gb-modal'],
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        tabindex: '-1'
      }
    });
    modal.classList.add('gb-modal-variant-' + variant);
    modal.dataset.dialogId = modalId;
    modal.dataset.dialogVariant = variant;
    modal.dataset.dialogResizable = opts.resizable === false ? 'off' : 'on';
    if (opts.geometryKey) modal.dataset.dialogGeometryKey = String(opts.geometryKey);
    if (variant === 'mobile-sheet') modal.dataset.mobileDialogSheet = 'on';
    if (opts.extraClass) modal.classList.add(opts.extraClass);
    if (opts.minWidth) modal.style.minWidth = (typeof opts.minWidth === 'number' ? opts.minWidth + 'px' : opts.minWidth);

    // header
    const header = el('div', { cls: ['gb-modal-header'] });
    header.appendChild(el('div', {
      cls: ['gb-modal-title'],
      text: opts.title || '',
      attrs: { id: titleId }
    }));
    let closeBtn = null;
    if (opts.closeButton !== false) {
      closeBtn = el('button', {
        cls: ['gb-modal-close'],
        title: '閉じる',
        attrs: { type: 'button', 'aria-label': opts.closeLabel || '閉じる' }
      });
      if (typeof lucide === 'function') closeBtn.innerHTML = lucide('x', 20);
      else closeBtn.textContent = '\u00D7';
      header.appendChild(closeBtn);
    }

    // body
    const body = el('div', { cls: ['gb-modal-body'] });
    if (opts.body) {
      const arr = Array.isArray(opts.body) ? opts.body : [opts.body];
      for (const c of arr) if (c instanceof Node) body.appendChild(c);
    }

    // footer
    // data-dialog-actions: gb-dialog-keyboard.js のアクション領域検出（矢印キーでの
    // ボタン移動）に拾わせるための共通マーカー。個別に .btn-row 等を付けない
    // createModal() 素の footer はこのマーカーでのみ検出される。
    const footer = el('div', { cls: ['gb-modal-footer'], attrs: { 'data-dialog-actions': '1' } });
    if (opts.footer) {
      const arr = Array.isArray(opts.footer) ? opts.footer : [opts.footer];
      for (const c of arr) if (c instanceof Node) footer.appendChild(c);
    }

    modal.appendChild(header);
    modal.appendChild(body);
    if (footer.childNodes.length) modal.appendChild(footer);
    overlay.appendChild(modal);

    let opener = opts.returnFocus === false ? null : document.activeElement;
    let closeCheckPending = false;
    let closed = false;
    let activated = false;
    let api = null;

    function _resolveReturnFocusTarget() {
      if (opts.returnFocus === false) return null;
      let target = opts.returnFocus;
      if (typeof target === 'function') target = target();
      if (!target?.focus) target = opener;
      return target;
    }

    function _restoreOpenerFocus() {
      if (opts.returnFocus === false) return true;
      const target = _resolveReturnFocusTarget();
      if (!target?.isConnected || !target?.focus) return true;
      const openDialogs = Array.from(document.querySelectorAll(
        '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'
      )).filter(dialog => dialog.isConnected && !dialog.hidden && !_isDialogClosingOrHidden(dialog));
      const topDialog = openDialogs[openDialogs.length - 1];
      // モバイルの閉じるアニメーション中に次のダイアログが開いた場合、旧画面の
      // 遅延focus復帰で新しい入力を奪わない。復帰先が残っている親ダイアログ内なら
      // ネストした子を閉じる通常契約なので、そのまま復帰させる。
      if (topDialog && topDialog !== modal && !topDialog.contains(target)) return true;
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
      return document.activeElement === target;
    }

    function _finishClose(reason) {
      if (closed) return false;
      closed = true;
      document.removeEventListener('keydown', onEscKey, true);
      if (overlay.parentNode) overlay.remove();
      let interactionClaimed = false;
      let trackingInteraction = false;
      let focusRestorationFinished = false;
      const claimInteraction = () => { interactionClaimed = true; };
      const stopTrackingInteraction = () => {
        focusRestorationFinished = true;
        if (!trackingInteraction) return;
        trackingInteraction = false;
        document.removeEventListener('pointerdown', claimInteraction, true);
        document.removeEventListener('keydown', claimInteraction, true);
      };
      // 閉じる操作そのものを新操作と数えないよう、次のtaskから利用者入力だけを追跡する。
      setTimeout(() => {
        if (focusRestorationFinished || interactionClaimed || trackingInteraction) return;
        trackingInteraction = true;
        document.addEventListener('pointerdown', claimInteraction, true);
        document.addEventListener('keydown', claimInteraction, true);
      }, 0);
      let restoreAttempts = 0;
      const restore = () => {
        if (overlay.isConnected) {
          setTimeout(restore, 40);
          return;
        }
        // レイアウト監視やブラウザ自身による自動focus移動では復帰を打ち切らない。
        // 閉鎖後に実際のpointer／keyboard入力があった時だけ利用者の選択を優先する。
        if (interactionClaimed) {
          stopTrackingInteraction();
          return;
        }
        const activeDialog = document.activeElement?.closest?.(
          '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'
        );
        if (activeDialog && activeDialog !== modal && !_isDialogClosingOrHidden(activeDialog)) {
          const restoreTarget = _resolveReturnFocusTarget();
          // A nested child dialog normally returns focus into its still-open parent.
          // Only a different dialog that does not own the return target represents a
          // newly claimed interaction and should cancel the bounded retry.
          if (!restoreTarget?.isConnected || !activeDialog.contains(restoreTarget)) {
            stopTrackingInteraction();
            return;
          }
        }
        // close-button のclick既定処理は、同期的な復帰に成功した直後でも、除去済み
        // ボタンから別要素へfocusを動かすことがある。短い監視期間中は復帰を再確認し、
        // 利用者入力または新しいダイアログがfocusを取得した時だけ終了する。
        _restoreOpenerFocus();
        // Mobile toolbars can keep their opener hidden until the modal-removal observer
        // refreshes the bar. Retry only while focus is still unclaimed, so a user's next
        // action or a newly opened dialog is never overridden.
        restoreAttempts += 1;
        if (restoreAttempts < 30) setTimeout(restore, 40);
        else stopTrackingInteraction();
      };
      restore();
      if (typeof opts.onClose === 'function') opts.onClose(reason, api);
      return true;
    }

    function close(reasonValue) {
      const reason = _modalCloseReason(reasonValue);
      if (closed || closeCheckPending) return false;
      let allowed = true;
      if (typeof opts.onBeforeClose === 'function') {
        try { allowed = opts.onBeforeClose(reason, api); } catch (error) {
          console.error('ダイアログを閉じる前の確認に失敗しました:', error);
          return false;
        }
      }
      if (allowed && typeof allowed.then === 'function') {
        closeCheckPending = true;
        return Promise.resolve(allowed).then(result => {
          closeCheckPending = false;
          return result === false ? false : _finishClose(reason);
        }, error => {
          closeCheckPending = false;
          console.error('ダイアログを閉じる前の確認に失敗しました:', error);
          return false;
        });
      }
      return allowed === false ? false : _finishClose(reason);
    }

    function _activate() {
      if (activated || !overlay.isConnected) return;
      activated = true;
      window.GBModalShell?.enhanceOverlay?.(overlay);
      const focusWhenCurrent = () => {
        if (!overlay.isConnected || closed || !_isTopmostModal(modal)) return;
        if (modal.contains(document.activeElement)) return;
        _focusModalTarget(opts.initialFocus, modal);
      };
      // 背景タブやheadless環境ではrequestAnimationFrameが間引かれるため、接続直後にも
      // 初期focusを確定する。描画後の補完は、利用者が既に別項目へ移動していない場合だけ行う。
      focusWhenCurrent();
      requestAnimationFrame(focusWhenCurrent);
      setTimeout(focusWhenCurrent, 40);
    }

    function open(parent) {
      if (closed) return api;
      if (!overlay.isConnected) {
        opener = opts.returnFocus === false ? null : document.activeElement;
        (parent?.appendChild ? parent : document.body).appendChild(overlay);
      }
      _activate();
      return api;
    }
    function onEscKey(ev) {
      if (ev.key !== 'Escape') return;
      if (!_isTopmostModal(modal)) return;
      // モーダル内で開いたアイコンピッカー等の非modalダイアログは、先に
      // 自身のEscape契約で閉じる。ここでイベントを奪うと親モーダルだけが
      // 閉じ、ピッカーが残るため、フォーカスが浮いた状態になる。
      const activeTransientDialog = document.activeElement?.closest?.('[role="dialog"][aria-modal="false"]');
      const transientDialog = activeTransientDialog || Array.from(
        document.querySelectorAll('[role="dialog"][aria-modal="false"]')
      ).reverse().find(node => {
        if (!node.isConnected || node.hidden || _isDialogClosingOrHidden(node)) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (transientDialog) return;
      // 最前面のモーダルがEscapeを処理した後、同じdocumentに登録された
      // 背景UIのEscapeハンドラへ流すと、閉鎖後に復帰させたフォーカスを
      // 別の操作が奪う。最前面ダイアログだけでこのキー入力を消費する。
      ev.stopImmediatePropagation();
      ev.stopPropagation();
      close('escape');
    }
    closeBtn?.addEventListener('click', () => close('close-button'));
    if (opts.closeOnOverlay !== false) {
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay && _isTopmostModal(modal)) close('overlay'); });
    }
    if (opts.closeOnEsc !== false) {
      // 背景UIのEscape処理より先に最前面モーダルで消費し、閉鎖後の
      // フォーカス復帰を遅延したメニュー処理に奪われないようcaptureで受ける。
      document.addEventListener('keydown', onEscKey, true);
    }

    api = { overlay, modal, header, body, footer, open, close, isOpen: () => overlay.isConnected && !closed };
    // 従来どおり呼び出し側が overlay を直接appendする経路も、次のmicrotaskで
    // 共通シェル適用と初期フォーカスを受けられるようにする。
    queueMicrotask(_activate);
    return api;
  }

  // ------------------------------------------------------------
  // Context Menu は Phase 2 範囲外
  // .gb-context-menu / -item / -sep は gb-tools.css 既存定義 + 100箇所超の
  // <div> ベース実装が稼働中。Phase 5 (ダイアログ・メニュー移行) で扱う。
  // ------------------------------------------------------------

  // ============================================================
  // Tab (panel-tab / inner-tab)
  // ============================================================
  // opts: { kind: 'panel'|'inner', label, icon, active, closable, onClick, onClose }
  function createTab(opts) {
    opts = opts || {};
    const inner = opts.kind === 'inner';
    const cls = inner ? 'gb-inner-tab' : 'gb-panel-tab';
    const tab = el('button', {
      cls: [cls],
      attrs: {
        type: 'button',
        role: 'tab',
        'aria-selected': opts.active ? 'true' : 'false'
      }
    });
    if (opts.active) tab.classList.add(inner ? 'gb-inner-tab-active' : 'gb-panel-tab-active');

    if (opts.icon) {
      const iconCls = inner ? 'gb-inner-tab-icon' : 'gb-panel-tab-icon';
      const wrap = el('span', { cls: [iconCls] });
      if (typeof opts.icon === 'string') {
        wrap.appendChild(el('span', { cls: ['ico', 'ico-' + opts.icon] }));
      } else if (opts.icon instanceof Node) {
        wrap.appendChild(opts.icon);
      }
      tab.appendChild(wrap);
    }
    if (opts.label != null) {
      const labelCls = inner ? 'gb-inner-tab-label' : 'gb-panel-tab-label';
      tab.appendChild(el('span', { cls: [labelCls], text: opts.label }));
    }
    if (opts.closable && !inner) {
      const close = el('span', {
        cls: ['gb-panel-tab-close'],
        text: '\u00D7',
        title: '閉じる',
        attrs: { role: 'button', tabindex: '0', 'aria-label': (opts.label ? opts.label + 'を閉じる' : 'タブを閉じる') }
      });
      close.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (typeof opts.onClose === 'function') opts.onClose(ev);
      });
      close.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof opts.onClose === 'function') opts.onClose(ev);
      });
      tab.appendChild(close);
    }
    if (typeof opts.onClick === 'function') tab.addEventListener('click', opts.onClick);
    return tab;
  }

  function createTabBar(items) {
    const bar = el('div', { cls: ['gb-tabbar'] });
    if (Array.isArray(items)) {
      for (const it of items) if (it instanceof Node) bar.appendChild(it);
    }
    return bar;
  }

  // ------------------------------------------------------------
  // Badge / Empty / Loading は Phase 2 範囲外
  // 既存 gb-tools.css に .gb-empty-state / .gb-spinner の定義があり、
  // gb-app.js / gb-history.js で .gb-empty-message / .gb-empty-hint を
  // 含む構造で運用中。Phase 5 以降で統合する。
  // ------------------------------------------------------------

  // ============================================================
  // applyVariant: 既存DOMノードに variant クラスを後付けする
  // ============================================================
  function applyVariant(node, variant) {
    if (!node || !variant) return node;
    // gb-btn 系
    if (node.classList.contains('gb-btn')) {
      ['primary', 'danger', 'quiet', 'ghost'].forEach(v => node.classList.remove('gb-btn-' + v));
      if (variant !== 'default') node.classList.add('gb-btn-' + variant);
    }
    return node;
  }

  // ============================================================
  // Range fill sync
  // ============================================================
  function _isRangeInput(node) {
    return !!(node && node.nodeType === 1 && node.matches && node.matches('input[type="range"]'));
  }

  function _rangeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function refreshRangeFill(input) {
    if (!_isRangeInput(input)) return input;
    const min = _rangeNumber(input.min, 0);
    const max = _rangeNumber(input.max, 100);
    const value = _rangeNumber(input.value, min);
    const pct = max === min ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    input.style.setProperty('--gb-range-fill-pct', pct.toFixed(3).replace(/\.?0+$/, '') + '%');
    return input;
  }

  function refreshRangeFills(root) {
    const scope = root || document;
    if (_isRangeInput(scope)) {
      refreshRangeFill(scope);
      return;
    }
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll('input[type="range"]').forEach(refreshRangeFill);
  }

  function _installRangeFillSync() {
    document.addEventListener('input', (ev) => refreshRangeFill(ev.target), true);
    document.addEventListener('change', (ev) => refreshRangeFill(ev.target), true);
    const start = () => {
      refreshRangeFills(document);
      const callback = (mutations) => {
        for (const m of mutations) m.addedNodes.forEach(refreshRangeFills);
      };
      const filter = (mutation) => Array.from(mutation.addedNodes || []).some((node) => {
        if (!node || node.nodeType !== 1) return false;
        return _isRangeInput(node) || !!node.querySelector?.('input[type="range"]');
      });
      if (window.GBMutationBus) {
        window.GBMutationBus.subscribe('gb-ui-range-fill', { filter, callback, throttle: 50 });
        return;
      }
      if (!window.MutationObserver || !document.body) return;
      new MutationObserver(callback).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  _installRangeFillSync();

  // 数値入力の横ドラッグ増減。クリック編集を保つため、一定距離を越えた時だけ
  // scrubへ移行し、動的生成された入力にもイベント委譲で適用する。
  function _numberDragStep(input, event) {
    const declared = Number.parseFloat(input?.step || '');
    const base = Number.isFinite(declared) && declared > 0 ? declared : 1;
    if (event?.ctrlKey) return base * 10;
    if (event?.shiftKey) return base / 10;
    return base;
  }

  function _numberDragPrecision(...values) {
    return Math.min(10, Math.max(0, ...values.map(value => {
      const text = String(value ?? '');
      if (/e-/i.test(text)) return Number(text.split(/e-/i)[1]) || 0;
      return (text.split('.')[1] || '').length;
    })));
  }

  function _numberDragClamp(input, value) {
    const min = Number.parseFloat(input?.min || '');
    const max = Number.parseFloat(input?.max || '');
    let next = value;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    return next;
  }

  function _numberDragValue(input, startValue, deltaX, event) {
    const step = _numberDragStep(input, event);
    const units = Math.trunc(deltaX / 4);
    let next = startValue + units * step;
    if (event?.ctrlKey) next = Math.round(next / step) * step;
    next = _numberDragClamp(input, next);
    const precision = _numberDragPrecision(step, input?.step, input?.min, input?.max);
    return Number(next.toFixed(precision));
  }

  function _installNumberInputDrag() {
    const state = { input: null, pointerId: null, startX: 0, startValue: 0, changed: false, scrubbing: false };
    const eventFor = type => new Event(type, { bubbles: true });
    const reset = () => {
      state.input?.classList?.remove('gb-number-input-scrubbing');
      document.documentElement.classList.remove('gb-number-scrubbing');
      state.input = null;
      state.pointerId = null;
      state.changed = false;
      state.scrubbing = false;
    };
    document.addEventListener('pointerdown', event => {
      const input = event.target?.closest?.('input[type="number"]');
      if (!input || event.button !== 0 || event.pointerType !== 'mouse') return;
      if (input.disabled || input.readOnly || input.dataset.numberDrag === 'off') return;
      const value = Number.parseFloat(input.value);
      if (!Number.isFinite(value)) return;
      state.input = input;
      state.pointerId = event.pointerId;
      state.startX = event.clientX;
      state.startValue = value;
      state.changed = false;
      state.scrubbing = false;
    }, true);
    window.addEventListener('pointermove', event => {
      if (!state.input || event.pointerId !== state.pointerId) return;
      const deltaX = event.clientX - state.startX;
      if (!state.scrubbing && Math.abs(deltaX) < 4) return;
      if (!state.scrubbing) {
        state.scrubbing = true;
        state.input.classList.add('gb-number-input-scrubbing');
        document.documentElement.classList.add('gb-number-scrubbing');
        try { state.input.setPointerCapture(event.pointerId); } catch {}
      }
      event.preventDefault();
      const next = _numberDragValue(state.input, state.startValue, deltaX, event);
      if (String(next) === state.input.value) return;
      state.input.value = String(next);
      state.changed = true;
      state.input.dispatchEvent(eventFor('input'));
    }, true);
    window.addEventListener('pointerup', event => {
      if (!state.input || event.pointerId !== state.pointerId) return;
      const input = state.input;
      const changed = state.changed;
      if (state.scrubbing) event.preventDefault();
      reset();
      if (changed) input.dispatchEvent(eventFor('change'));
    }, true);
    window.addEventListener('pointercancel', reset, true);
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !state.input || !state.scrubbing) return;
      const input = state.input;
      const changed = state.changed && Number.parseFloat(input.value) !== state.startValue;
      input.value = String(state.startValue);
      event.preventDefault();
      event.stopPropagation();
      reset();
      if (changed) {
        input.dispatchEvent(eventFor('input'));
        input.dispatchEvent(eventFor('change'));
      }
    }, true);
    window.addEventListener('blur', () => {
      if (state.input) reset();
    });
  }

  _installNumberInputDrag();

  // ============================================================
  // ポップアップ内フォーカス循環（Tab / Shift+Tab）
  // ルビ入力ポップアップ・選択時書式ポップアップなど、開いている間だけ
  // Tab でポップアップ内の操作項目を順番に切り替えるための共通処理。
  // ============================================================
  function cyclePopupFocus(popup, backward) {
    if (!popup || !popup.querySelectorAll) return false;
    const items = Array.from(popup.querySelectorAll('button, input, select, textarea, [tabindex]'))
      .filter((item) => {
        if (item.disabled || item.tabIndex < 0) return false;
        const rect = item.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    if (!items.length) return false;
    const current = items.indexOf(document.activeElement);
    const next = current < 0
      ? (backward ? items.length - 1 : 0)
      : (current + (backward ? -1 : 1) + items.length) % items.length;
    try { items[next].focus({ preventScroll: true }); } catch { items[next].focus(); }
    return true;
  }
  window.gbCyclePopupFocus = cyclePopupFocus;

  // ============================================================
  // Public API
  // ============================================================
  window.GBUI = {
    // primitives
    el,
    // button
    createButton,
    // toolbar
    createToolbar, createToolbarSep, createToolbarGroup,
    // panel
    createPanelHeader, createPanelBody, createPanelSubheader,
    // section
    createSection,
    // field
    createField, createFieldRow, createFieldInline,
    buildField, buildInput, buildSelect, buildTextarea,
    buildNumInput, buildTextInputSm, buildCheck, buildRadio,
    createCheckRow,
    // color swatch
    createColorSwatch, applySwatchColor, setSwatchOverridden,
    createResetBtn,
    // format / style
    createFmtBtn, createStyleTrigger, setStyleTriggerLabel,
    // table
    createDataTable,
    // modal
    createModal,
    // tab
    createTab, createTabBar,
    // misc
    applyVariant,
    refreshRangeFill,
    refreshRangeFills,
    cyclePopupFocus,
    numberDrag: {
      step: _numberDragStep,
      value: _numberDragValue,
    }
  };
})();
