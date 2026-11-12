/* gb-template-picker.js: 全アプリ共通のテンプレート選択画面（サムネイル一覧＋プレビュー）。
 *
 * ノート・シナリオ・シート・ボードのテンプレート選択は、すべてこの画面を使う。
 * 各アプリは「項目一覧」「サムネイルの描き方」「適用などの操作」だけを渡す。
 *
 * MeldexTemplatePicker.open({
 *   id, title, searchPlaceholder, emptyText,
 *   items: [{ id, name, description, category, categoryLabel, builtin, badge,
 *             renderThumbnail(host, { size: 'card' | 'large' }), details(host) }],
 *   loadItems: async () => items,            // items の代わりに非同期で読む場合
 *   selectedId,                              // 開いた時に選ぶ項目
 *   currentId,                               // 「使用中」を表示する項目
 *   primaryAction: { label, run(item, ctx) },// 決定ボタン（カードのダブルクリックでも実行）
 *   itemActions: [{ label, run(item, ctx), when(item), danger }],
 *   footerActions: [{ label, run(ctx), e2eId }],
 *   e2e: { dialog, grid, preview, search, card, categoryPrefix, apply, close },  // 既存テストの識別子を保つ時
 *   cardClass,                               // カードに足すクラス
 * })
 * run が true を返すと閉じる。ctx = { close, refresh, setStatus, select }。
 */
(function initMeldexTemplatePicker(global) {
  'use strict';

  const CATEGORY_ALL = '__all__';


  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function button(label, cls, e2eId) {
    const node = el('button', cls || 'gb-btn', label);
    node.type = 'button';
    if (e2eId) node.dataset.e2eId = e2eId;
    return node;
  }

  function normalizeItems(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter(item => {
      if (!item || item.id == null || seen.has(String(item.id))) return false;
      seen.add(String(item.id));
      return true;
    }).map(item => ({ ...item, id: String(item.id), name: String(item.name || '名前のないテンプレート') }));
  }

  function categoriesOf(items) {
    const result = [];
    const seen = new Set();
    items.forEach(item => {
      const key = String(item.category || '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push({ key, label: String(item.categoryLabel || key) });
    });
    return result;
  }

  function matches(item, query, category) {
    if (category !== CATEGORY_ALL && String(item.category || '') !== category) return false;
    if (!query) return true;
    const hay = [item.name, item.description, item.categoryLabel, item.badge].join(' ').toLocaleLowerCase();
    return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every(part => hay.includes(part));
  }

  function renderThumb(item, host, size) {
    host.replaceChildren();
    try {
      if (typeof item.renderThumbnail === 'function') item.renderThumbnail(host, { size });
    } catch (error) {
      host.replaceChildren(el('span', 'gb-tpl-thumb-fallback', 'プレビューを表示できません'));
      console.warn('[template-picker] thumbnail failed', error);
    }
    if (!host.childNodes.length) host.appendChild(el('span', 'gb-tpl-thumb-fallback', item.name));
  }

  function isMobileSheetMode() {
    const body = document.body?.dataset || {};
    return body.cloudMobile === '1' || body.mobileUi === '1' || body.mobileUiLocal === '1'
      || global.MeldexCloudMobileState?.mobile === true;
  }

  // ダイアログ共通の枠は最初に測った寸法で固定するため、中身が描画される前の小さい寸法に
  // ならないよう、パソコン幅では開く前に大きさを決めておく（利用者が変えた寸法は枠側が復元する）。
  function sizeModal(modal) {
    if (!modal || isMobileSheetMode()) return;
    const zoom = typeof global._getZoom === 'function' ? Math.max(0.1, global._getZoom() || 1) : 1;
    const width = (global.visualViewport?.width || global.innerWidth || 1024) / zoom;
    const height = (global.visualViewport?.height || global.innerHeight || 768) / zoom;
    modal.style.width = Math.round(Math.max(320, Math.min(1080, width - 48))) + 'px';
    modal.style.height = Math.round(Math.max(420, Math.min(760, height - 64))) + 'px';
  }

  function open(options = {}) {
    if (!global.GBUI?.createModal) throw new Error('ダイアログ部品を読み込めませんでした');

    const pickerId = String(options.id || 'template-picker');
    let items = normalizeItems(options.items);
    let selectedId = options.selectedId != null ? String(options.selectedId) : '';
    let category = CATEGORY_ALL;
    let query = '';
    let busy = false;
    let forceClose = false;

    const root = el('div', 'gb-tpl-picker');
    root.dataset.templatePicker = pickerId;
    const toolbar = el('div', 'gb-tpl-toolbar');
    const search = el('input', 'gb-input gb-tpl-search');
    search.type = 'search';
    search.placeholder = options.searchPlaceholder || 'テンプレートを検索';
    search.setAttribute('aria-label', 'テンプレートを検索');
    const e2e = options.e2e || {};
    search.dataset.e2eId = e2e.search || `${pickerId}-search`;
    const chips = el('div', 'gb-tpl-chips');
    chips.setAttribute('role', 'tablist');
    chips.setAttribute('aria-label', 'テンプレートの分類');
    toolbar.append(search, chips);

    const body = el('div', 'gb-tpl-body');
    const grid = el('div', 'gb-tpl-grid');
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', options.title || 'テンプレート');
    grid.dataset.e2eId = e2e.grid || `${pickerId}-grid`;
    const preview = el('section', 'gb-tpl-preview');
    preview.setAttribute('aria-live', 'polite');
    preview.dataset.e2eId = e2e.preview || `${pickerId}-preview`;
    body.append(grid, preview);
    const status = el('p', 'gb-tpl-status');
    status.setAttribute('role', 'status');
    root.append(toolbar, body, status);

    const footer = [];
    (options.footerActions || []).forEach(action => {
      const node = button(action.label, 'gb-btn', action.e2eId);
      node.addEventListener('click', () => runAction(() => action.run(ctx)));
      footer.push(node);
    });
    const primaryFooter = options.primaryAction
      ? button(options.primaryAction.label || '適用', 'gb-btn gb-btn-primary', e2e.apply || `${pickerId}-apply`)
      : null;
    if (primaryFooter) footer.push(primaryFooter);

    const modal = global.GBUI.createModal({
      id: pickerId,
      title: options.title || 'テンプレート',
      body: root,
      footer,
      variant: 'standard',
      geometryKey: pickerId,
      extraClass: 'gb-tpl-picker-modal',
      initialFocus: () => grid.querySelector('.gb-tpl-card.is-selected') || search,
      onBeforeClose: () => !busy || forceClose,
      onClose: options.onClose,
    });

    const ctx = {
      close(reason) { forceClose = true; return modal.close(reason || 'done'); },
      async refresh(nextItems) {
        if (nextItems) items = normalizeItems(nextItems);
        else if (typeof options.loadItems === 'function') items = normalizeItems(await options.loadItems());
        if (!items.some(item => item.id === selectedId)) selectedId = items[0]?.id || '';
        render();
      },
      setStatus(message, isError) {
        status.textContent = String(message || '');
        status.classList.toggle('is-error', !!isError);
      },
      select(id) { selectedId = String(id || ''); render(); },
      get selected() { return items.find(item => item.id === selectedId) || null; },
      overlay: modal.overlay,
      modal: modal.modal,
    };

    async function runAction(fn) {
      if (busy) return;
      busy = true;
      root.classList.add('is-busy');
      // 処理中は二重送信を防ぎ、支援技術にも処理中であることを伝える（Escape等でも閉じない）。
      modal.modal.setAttribute('aria-busy', 'true');
      const controls = [...modal.modal.querySelectorAll('button, input')].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      ctx.setStatus('');
      let result = false;
      try {
        result = await fn();
      } catch (error) {
        ctx.setStatus(error?.userMessage || error?.message || String(error), true);
      } finally {
        busy = false;
        root.classList.remove('is-busy');
        modal.modal.setAttribute('aria-busy', 'false');
        controls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
      }
      if (result === true) modal.close('applied');
    }

    function selectedItem() {
      return items.find(item => item.id === selectedId) || null;
    }

    function runPrimary(item) {
      if (!item || !options.primaryAction) return;
      runAction(() => options.primaryAction.run(item, ctx));
    }
    primaryFooter?.addEventListener('click', () => runPrimary(selectedItem()));

    function renderChips() {
      const cats = categoriesOf(items);
      chips.replaceChildren();
      chips.hidden = cats.length < 2;
      [{ key: CATEGORY_ALL, label: 'すべて' }, ...cats].forEach(cat => {
        const chipKey = cat.key === CATEGORY_ALL ? 'all' : cat.key;
        const chip = button(cat.label, 'gb-tpl-chip' + (cat.key === category ? ' is-active' : ''), (e2e.categoryPrefix || `${pickerId}-category-`) + chipKey);
        chip.dataset.category = chipKey;
        chip.setAttribute('role', 'tab');
        chip.setAttribute('aria-selected', cat.key === category ? 'true' : 'false');
        chip.addEventListener('click', () => { category = cat.key; render(); });
        chips.appendChild(chip);
      });
    }

    function renderGrid() {
      const visible = items.filter(item => matches(item, query, category));
      grid.replaceChildren();
      if (!visible.length) {
        grid.appendChild(el('p', 'gb-tpl-empty', items.length ? '一致するテンプレートはありません' : (options.emptyText || 'テンプレートはありません')));
        return visible;
      }
      if (!visible.some(item => item.id === selectedId)) selectedId = visible[0].id;
      visible.forEach(item => {
        const card = el('button', 'gb-tpl-card' + (options.cardClass ? ' ' + options.cardClass : '') + (item.id === selectedId ? ' is-selected' : ''));
        card.type = 'button';
        card.setAttribute('role', 'option');
        card.setAttribute('aria-selected', item.id === selectedId ? 'true' : 'false');
        card.dataset.templateId = item.id;
        card.dataset.e2eId = e2e.card || `${pickerId}-card`;
        const thumb = el('span', 'gb-tpl-thumb');
        thumb.setAttribute('aria-hidden', 'true');
        renderThumb(item, thumb, 'card');
        const label = el('span', 'gb-tpl-card-label');
        label.appendChild(el('span', 'gb-tpl-card-name', item.name));
        const badgeText = item.id === options.currentId ? '使用中' : (item.badge || (item.builtin ? '' : 'カスタム'));
        if (badgeText) label.appendChild(el('span', 'gb-tpl-card-badge', badgeText));
        card.append(thumb, label);
        if (item.description) card.title = item.description;
        card.addEventListener('click', () => {
          if (selectedId === item.id) return;
          selectedId = item.id;
          grid.querySelectorAll('.gb-tpl-card').forEach(node => {
            const on = node.dataset.templateId === item.id;
            node.classList.toggle('is-selected', on);
            node.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          renderPreview();
        });
        card.addEventListener('dblclick', () => runPrimary(item));
        grid.appendChild(card);
      });
      return visible;
    }

    function renderPreview() {
      const item = selectedItem();
      if (primaryFooter) {
        const available = !!item && (typeof options.primaryAction.when !== 'function' || options.primaryAction.when(item));
        primaryFooter.hidden = !available;
        primaryFooter.disabled = !available;
      }
      preview.replaceChildren();
      if (item) preview.dataset.templateId = item.id; else delete preview.dataset.templateId;
      if (!item) {
        preview.appendChild(el('p', 'gb-tpl-empty', 'テンプレートを選んでください'));
        return;
      }
      const large = el('div', 'gb-tpl-thumb gb-tpl-thumb--large');
      large.setAttribute('aria-hidden', 'true');
      renderThumb(item, large, 'large');
      const head = el('div', 'gb-tpl-preview-head');
      head.appendChild(el('h3', 'gb-tpl-preview-name', item.name));
      if (item.categoryLabel) head.appendChild(el('span', 'gb-tpl-card-badge', item.categoryLabel));
      preview.append(large, head);
      if (item.description) preview.appendChild(el('p', 'gb-tpl-preview-desc', item.description));
      if (typeof item.details === 'function') {
        const details = el('div', 'gb-tpl-preview-details');
        try { item.details(details); } catch (error) { console.warn('[template-picker] details failed', error); }
        if (details.childNodes.length) preview.appendChild(details);
      }
      const actions = el('div', 'gb-tpl-preview-actions');
      (options.itemActions || []).forEach((action, index) => {
        if (typeof action.when === 'function' && !action.when(item)) return;
        const node = button(action.label, 'gb-btn' + (action.danger ? ' gb-btn-danger' : ''), action.e2eId || `${pickerId}-action-${index}`);
        node.addEventListener('click', () => runAction(() => action.run(item, ctx)));
        actions.appendChild(node);
      });
      if (actions.childNodes.length) preview.appendChild(actions);
    }

    function render() {
      renderChips();
      renderGrid();
      renderPreview();
    }

    search.addEventListener('input', () => { query = search.value.trim(); renderGrid(); renderPreview(); });
    grid.addEventListener('keydown', event => {
      const cards = [...grid.querySelectorAll('.gb-tpl-card')];
      const index = cards.indexOf(document.activeElement);
      if (index < 0) return;
      // Enter/Space はカードの選択（ボタンの既定動作）。適用はプレビュー欄の決定ボタンかダブルクリックで行い、
      // キー操作だけで内容を書き換えない。
      const columns = Math.max(1, Math.round(grid.clientWidth / Math.max(1, cards[0].offsetWidth || 1)));
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = cards[Math.max(0, Math.min(cards.length - 1, index + step))];
      next.focus();
      next.click();
    });

    sizeModal(modal.modal);
    if (e2e.dialog) modal.modal.dataset.e2eId = e2e.dialog;
    if (e2e.close) { const closeBtn = modal.header?.querySelector('.gb-modal-close'); if (closeBtn) closeBtn.dataset.e2eId = e2e.close; }
    modal.open();
    if (typeof options.loadItems === 'function' && !options.items) {
      grid.appendChild(el('p', 'gb-tpl-empty', '読み込み中…'));
      ctx.refresh().catch(error => ctx.setStatus(error?.message || String(error), true));
    } else {
      render();
    }
    return ctx;
  }

  global.MeldexTemplatePicker = Object.freeze({ open });
}(typeof globalThis !== 'undefined' ? globalThis : window));
