/* 段落ごとのステータスと、ノート要素/ステータス表示フィルター。 */
(function (global) {
  'use strict';

  const STATUSES = [
    { id: '', label: '未設定' },
    { id: 'todo', label: '未着手' },
    { id: 'doing', label: '進行中' },
    { id: 'done', label: '完了' },
    { id: 'hold', label: '保留' },
  ];
  const CATEGORY = [
    { id: 'heading', label: '見出し', selector: 'h1,h2,h3,h4,h5,h6' },
    { id: 'callout', label: 'コールアウト', selector: '.callout-block' },
    { id: 'paragraph', label: '本文', selector: ':scope > div:not(.callout-block)' },
    { id: 'list', label: 'リスト', selector: 'ul,ol' },
    { id: 'quote', label: '引用', selector: 'blockquote' },
    { id: 'code', label: 'コード', selector: 'pre' },
    { id: 'table', label: 'テーブル', selector: 'table' },
  ];
  const STORAGE_KEY = 'meldex-note-display-filter-v1';
  let lastBlock = null;
  let popup = null;

  function editor() { return document.getElementById('page-content'); }
  function readFilter() {
    const initial = { categories: {}, statuses: {} };
    CATEGORY.forEach(item => { initial.categories[item.id] = true; });
    STATUSES.forEach(item => { initial.statuses[item.id || 'unset'] = true; });
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.categories) Object.assign(initial.categories, saved.categories);
      if (saved?.statuses) Object.assign(initial.statuses, saved.statuses);
    } catch {}
    return initial;
  }
  let filter = readFilter();

  function currentBlock() {
    const host = editor();
    const sel = global.getSelection?.();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (host && range && host.contains(range.startContainer) && global.MeldexNoteBlockTypes?.resolveCurrentBlock) {
      return global.MeldexNoteBlockTypes.resolveCurrentBlock(host, range)?.block || null;
    }
    return lastBlock && host?.contains(lastBlock) ? lastBlock : null;
  }

  function rememberSelection() {
    const block = currentBlock();
    if (block) lastBlock = block;
    syncStatusButton();
  }

  function statusLabel(id) {
    return STATUSES.find(item => item.id === id)?.label || '未設定';
  }

  function syncStatusButton() {
    const button = document.getElementById('page-note-status-btn');
    if (!button) return;
    const status = currentBlock()?.dataset?.noteStatus || '';
    button.title = `段落ステータス: ${statusLabel(status)}`;
    button.setAttribute('aria-label', button.title);
    button.dataset.noteStatus = status || 'unset';
  }

  function closePopup() {
    popup?.remove();
    popup = null;
    document.removeEventListener('pointerdown', outsidePopup, true);
  }
  function outsidePopup(event) {
    if (popup?.contains(event.target)) return;
    if (event.target?.closest?.('#page-note-status-btn,#page-note-filter-btn')) return;
    closePopup();
  }
  function openPopup(anchor, title) {
    closePopup();
    popup = document.createElement('div');
    popup.className = 'note-status-filter-popup gb-context-menu';
    popup.setAttribute('role', 'menu');
    const heading = document.createElement('div');
    heading.className = 'note-status-filter-popup-title';
    heading.textContent = title;
    popup.appendChild(heading);
    document.body.appendChild(popup);
    const rect = anchor.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 300))}px`;
    popup.style.top = `${Math.min(rect.bottom + 6, innerHeight - 420)}px`;
    setTimeout(() => document.addEventListener('pointerdown', outsidePopup, true), 0);
    return popup;
  }

  function emitChange(block) {
    try {
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatBlock' }));
    } catch {
      block.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function showStatusMenu(anchor) {
    const host = editor();
    if (!host?.isContentEditable || (typeof isItemLocked === 'function' && isItemLocked(host.dataset?.path))) {
      if (typeof showStatus === 'function') showStatus('読取専用のノートは変更できません', true);
      return;
    }
    const block = currentBlock();
    if (!block) {
      if (typeof showStatus === 'function') showStatus('ステータスを設定する段落を選択してください', true);
      return;
    }
    lastBlock = block;
    const menu = openPopup(anchor, '段落ステータス');
    STATUSES.forEach(item => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'note-status-filter-row';
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', (block.dataset.noteStatus || '') === item.id ? 'true' : 'false');
      row.innerHTML = `<span class="note-status-dot" data-status="${item.id || 'unset'}"></span><span></span>`;
      row.lastElementChild.textContent = item.label;
      row.addEventListener('click', () => {
        if (!host.isContentEditable || !host.contains(block)
            || (typeof isItemLocked === 'function' && isItemLocked(host.dataset?.path))) {
          closePopup();
          return;
        }
        if (item.id) {
          block.dataset.noteStatus = item.id;
          block.classList.add('note-status-block');
        } else {
          delete block.dataset.noteStatus;
          block.classList.remove('note-status-block');
        }
        block.dataset.noteStatusLabel = item.label;
        emitChange(block);
        applyFilter();
        syncStatusButton();
        closePopup();
      });
      menu.appendChild(row);
    });
  }

  function checkboxRow(label, checked, onChange) {
    const row = document.createElement('label');
    row.className = 'note-status-filter-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(input, document.createTextNode(label));
    return row;
  }

  function saveAndApply() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
    applyFilter();
  }

  function showFilterMenu(anchor) {
    const menu = openPopup(anchor, '表示する要素');
    CATEGORY.forEach(item => menu.appendChild(checkboxRow(item.label, filter.categories[item.id] !== false, value => {
      filter.categories[item.id] = value;
      saveAndApply();
    })));
    const divider = document.createElement('div');
    divider.className = 'gb-context-menu-sep';
    menu.appendChild(divider);
    const statusTitle = document.createElement('div');
    statusTitle.className = 'note-status-filter-section-title';
    statusTitle.textContent = 'ステータス';
    menu.appendChild(statusTitle);
    STATUSES.forEach(item => {
      const key = item.id || 'unset';
      menu.appendChild(checkboxRow(item.label, filter.statuses[key] !== false, value => {
        filter.statuses[key] = value;
        saveAndApply();
      }));
    });
  }

  function categoryFor(block) {
    if (/^H[1-6]$/.test(block.tagName)) return 'heading';
    if (block.classList.contains('callout-block')) return 'callout';
    if (block.matches('ul,ol')) return 'list';
    if (block.matches('blockquote')) return 'quote';
    if (block.matches('pre')) return 'code';
    if (block.matches('table')) return 'table';
    return 'paragraph';
  }

  function applyFilter() {
    const host = editor();
    if (!host) return;
    function filterChildren(container) { [...container.children].forEach(block => {
      if (block.matches('section.heading-section')) {
        block.classList.remove('note-filter-hidden');
        filterChildren(block);
        return;
      }
      if (block.classList.contains('note-status-marker')) return;
      const categoryVisible = filter.categories[categoryFor(block)] !== false;
      // リストの状態は UL/OL 全体ではなく各 LI に付く。要素種別の表示は
      // コンテナ、ステータスの表示は項目ごとに判定して両方を合成する。
      const isList = block.matches('ul,ol');
      const statusVisible = isList || filter.statuses[block.dataset.noteStatus || 'unset'] !== false;
      block.classList.toggle('note-filter-hidden', !(categoryVisible && statusVisible));
      if (isList) {
        block.querySelectorAll('li').forEach(item => {
          const itemVisible = filter.statuses[item.dataset.noteStatus || 'unset'] !== false;
          item.classList.toggle('note-filter-hidden', !itemVisible);
        });
      }
    }); }
    filterChildren(host);
    const active = !!host.querySelector('.note-filter-hidden');
    document.getElementById('page-note-filter-btn')?.classList.toggle('active', active);
  }

  function init() {
    const statusButton = document.getElementById('page-note-status-btn');
    const filterButton = document.getElementById('page-note-filter-btn');
    // tb-icon-btn の ico-* 疑似アイコン一覧へ依存させず、既存の Lucide
    // ヘルパーから直接描画する。Cloud 静的版でも同じボタンが空にならない。
    if (typeof global.lucide === 'function') {
      if (statusButton) statusButton.innerHTML = global.lucide('circleDot', 16);
      if (filterButton) filterButton.innerHTML = global.lucide('listFilter', 16);
    }
    statusButton?.addEventListener('pointerdown', rememberSelection);
    statusButton?.addEventListener('click', event => showStatusMenu(event.currentTarget));
    filterButton?.addEventListener('click', event => showFilterMenu(event.currentTarget));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closePopup();
    });
    document.addEventListener('selectionchange', rememberSelection);
    const host = editor();
    if (host && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => applyFilter()).observe(host, { childList: true, subtree: true });
    }
    applyFilter();
    syncStatusButton();
  }

  global.MeldexNoteStatusFilter = { init, applyFilter, showStatusMenu, showFilterMenu, STATUSES };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
