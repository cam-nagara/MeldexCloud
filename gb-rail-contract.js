/* ================================================================
   gb-rail-contract.js — 固定レールの順序・区切り・キーボード契約

   レイアウト保存値とDOM描画が別々の順序表を持たないための単一正本。
   既存レイアウトの幅・開閉・activeGroupId・未知のカスタムパネルは
   変更せず、既定パネルだけを一度だけ正規順序へ移行する。
   ================================================================ */
(function () {
  'use strict';

  const VERSION = 3;
  const RIGHT = Object.freeze([
    { type: 'detail',      label: 'オプション',       icon: 'slidersHorizontal', section: 'primary' },
    { type: 'preview',     label: 'ビューワー',       icon: 'panelTop',          section: 'primary' },
    { type: 'subpanel',    label: 'サブパネル',       icon: 'panelRight',        section: 'primary', separatorAfter: true },
    { type: 'information', label: 'プロパティ',       icon: 'info',              section: 'context' },
    { type: 'tags',        label: 'タグ',             icon: 'tags',              section: 'context' },
    { type: 'backlinks',   label: 'バックリンク',     icon: 'fileSymlink',       section: 'context' },
    { type: 'annotation',  label: 'アノテート',       icon: 'squarePen',         section: 'context' },
    { type: 'file-theme',  label: 'テーマ',           icon: 'palette',           section: 'context', separatorAfter: true },
    { type: 'history',     label: 'ヒストリー',       icon: 'history',           section: 'record' },
    { type: 'version',     label: 'バージョン管理',   icon: 'gitBranch',         section: 'record', separatorAfter: true },
    { type: 'chat',        label: 'チャット',         icon: 'messagesSquare',    section: 'bottom' },
  ]);
  const RETIRED_TYPES = Object.freeze(['timer']);
  const QUICK_MEMO = Object.freeze({
    type: 'quick-memo', label: 'クイックメモ', icon: 'notebookPen', section: 'bottom', external: true,
  });
  const BY_TYPE = new Map(RIGHT.map((item, index) => [item.type, Object.freeze({ ...item, index })]));

  function definitions() { return RIGHT.slice(); }
  function defaults() { return RIGHT.map(item => [item.label, item.type]); }
  function types() { return new Set(RIGHT.map(item => item.type)); }
  function definition(type) { return BY_TYPE.get(String(type || '')) || null; }
  function order(type) { return definition(type)?.index ?? Number.MAX_SAFE_INTEGER; }
  function isBottom(type) { return definition(type)?.section === 'bottom' || type === QUICK_MEMO.type; }

  function _focusableButtons(root) {
    return Array.from(root.querySelectorAll('button.gb-dock-icon:not([disabled])'))
      .filter(button => button.offsetParent !== null || !document.body.contains(root));
  }

  function _syncScrollState(scroll) {
    if (!scroll) return;
    const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    scroll.classList.toggle('can-scroll-up', scroll.scrollTop > 1);
    scroll.classList.toggle('can-scroll-down', scroll.scrollTop < max - 1);
  }

  function decorate(dockBar, side) {
    if (!dockBar || !side || dockBar.dataset.railContractVersion === String(VERSION)) return;
    dockBar.dataset.railContractVersion = String(VERSION);
    const children = Array.from(dockBar.children);
    const top = document.createElement('div');
    const scroll = document.createElement('div');
    const bottom = document.createElement('div');
    top.className = 'gb-rail-shell-top';
    scroll.className = 'gb-rail-shell-scroll';
    bottom.className = 'gb-rail-shell-bottom';

    children.forEach((node) => {
      if (node.classList?.contains('gb-dock-rail-toggle')) {
        top.appendChild(node);
        return;
      }
      const type = node.dataset?.tabType || (node.classList?.contains('gb-dock-rail-quick-memo') ? QUICK_MEMO.type : '');
      const def = definition(type) || (type === QUICK_MEMO.type ? QUICK_MEMO : null);
      if (def) {
        node.setAttribute('aria-label', def.label);
        node.dataset.gbTooltip = def.label;
        node.dataset.railSection = def.section;
        if (def.separatorAfter) node.classList.add('gb-rail-separator-after');
      }
      (side === 'right' && isBottom(type) ? bottom : scroll).appendChild(node);
    });

    dockBar.replaceChildren(top, scroll, bottom);
    scroll.addEventListener('scroll', () => _syncScrollState(scroll), { passive: true });
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => _syncScrollState(scroll))
      : null;
    resizeObserver?.observe(scroll);
    requestAnimationFrame(() => _syncScrollState(scroll));

    dockBar.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const buttons = _focusableButtons(dockBar);
      if (!buttons.length) return;
      const current = Math.max(0, buttons.indexOf(document.activeElement));
      let next = current;
      if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
      if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      event.preventDefault();
      buttons[next].focus();
      buttons[next].scrollIntoView({ block: 'nearest' });
    });
  }

  window.GBRailContract = Object.freeze({
    version: VERSION,
    quickMemo: QUICK_MEMO,
    definitions,
    defaults,
    types,
    retiredTypes: () => RETIRED_TYPES.slice(),
    definition,
    order,
    isBottom,
    decorate,
  });
})();
