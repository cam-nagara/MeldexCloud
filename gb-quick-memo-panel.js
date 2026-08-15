/* ==============================
   gb-quick-memo-panel.js — クイックメモのフロートパネル

   右レール下端のボタンから、クイックメモを作業領域の上へ一時的に浮かべる。
   メインパネルのタブにも右サイドバーにもならないので、いま開いている作業を
   崩さずにメモを書ける。

   中身は単独アプリ版と同じ quick-memo.html を iframe で読み込む。保存経路も
   単独アプリ版と同じ（/api/quick-memo → シートのエントリ）なので、本体側で
   保存処理を二重に持たない。パネルを閉じても書きかけは quick-memo 側の
   下書き保存に残り、送信待ちは gb-quick-memo-sync.js が引き取る。

   ダイアログより手前には出さない（z-index はモーダル未満）。

   移動・8方向リサイズ・画面外補正・表示倍率対応・位置記憶・Escape・重なり順の
   骨組みは gb-float-panel-base.js（v0.7.268期に共通化）に委譲する。見た目・
   挙動は移行前と変えていない（CSSクラス名・DOM構造・E2E用の data-e2e-id は
   すべて据え置き）。
   ============================== */
(function () {
  'use strict';

  const PANEL_ID = 'gb-quick-memo-panel';
  const RECT_KEY = 'meldex:quick-memo-panel:rect:v1';
  const FRAME_URL = 'quick-memo.html?embed=1';
  const MIN_W = 300;
  const MIN_H = 320;
  const DEFAULT_W = 420;
  const DEFAULT_H = 620;
  const MARGIN = 8;

  let _frame = null;
  let _base = null;

  function _icon(name, size) {
    return (typeof lucide === 'function') ? lucide(name, size || 16) : '';
  }

  function _openStandalone() {
    const url = 'quick-memo.html';
    if (typeof _open_app_window_js === 'function') {
      _open_app_window_js(url);
      return;
    }
    window.open(url, '_blank', 'width=480,height=780,menubar=no,toolbar=no,location=no');
  }

  // 書きかけを取りこぼさないよう、閉じる前にクイックメモ側の保存を促す。
  // 失敗しても下書きは quick-memo 側の localStorage に残り、送信待ちは
  // gb-quick-memo-sync.js が後から引き取るので、閉じる操作自体は止めない。
  function _flushFrame() {
    try {
      const api = _frame?.contentWindow?.MeldexQuickMemo;
      if (api && typeof api.flush === 'function') api.flush();
    } catch {}
  }

  function _buildHeader(header) {
    header.dataset.e2eId = 'quick-memo-float-panel-header';
    header.innerHTML = `
      <span class="gb-quick-memo-panel-icon"></span>
      <span class="gb-quick-memo-panel-title">クイックメモ</span>
      <button type="button" class="gb-quick-memo-panel-btn" data-role="standalone"
              data-e2e-id="quick-memo-float-panel-standalone"
              title="単独アプリとして起動" aria-label="単独アプリとして起動"></button>
      <button type="button" class="gb-quick-memo-panel-btn" data-role="close"
              data-e2e-id="quick-memo-float-panel-close"
              title="閉じる" aria-label="閉じる"></button>
    `;
    header.querySelector('.gb-quick-memo-panel-icon').innerHTML = _icon('notebookPen', 16);
    header.querySelector('[data-role="standalone"]').innerHTML = _icon('externalLink', 14);
    header.querySelector('[data-role="close"]').innerHTML = _icon('x', 14);
    header.querySelector('[data-role="standalone"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _openStandalone();
    });
    header.querySelector('[data-role="close"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });
  }

  function _buildBody(body) {
    const frame = document.createElement('iframe');
    frame.className = 'gb-quick-memo-panel-frame';
    frame.title = 'クイックメモ';
    frame.dataset.e2eId = 'quick-memo-float-panel-frame';
    frame.src = FRAME_URL;
    body.appendChild(frame);
    _frame = frame;
  }

  function _base_() {
    if (_base) return _base;
    _base = window.GBFloatPanelBase.create({
      id: PANEL_ID,
      className: 'gb-quick-memo-panel',
      headerClassName: 'gb-quick-memo-panel-header',
      bodyClassName: 'gb-quick-memo-panel-body',
      resizeHandleClassName: 'gb-quick-memo-panel-resize-handle',
      dataE2eId: 'quick-memo-float-panel',
      ariaLabel: 'クイックメモ',
      storageKey: RECT_KEY,
      minWidth: MIN_W,
      minHeight: MIN_H,
      defaultWidth: DEFAULT_W,
      defaultHeight: DEFAULT_H,
      margin: MARGIN,
      anchorSelector: '.gb-dock-fixed-right',
      triggerSelectors: '.gb-dock-rail-quick-memo',
      buildHeader: _buildHeader,
      buildBody: _buildBody,
      onDragToggle: (enabled) => { if (_frame) _frame.style.pointerEvents = enabled ? '' : 'none'; },
      onFocus: () => { try { _frame?.contentWindow?.focus?.(); } catch {} },
      onBeforeClose: () => { _flushFrame(); },
      onClose: () => { _frame = null; },
    });
    return _base;
  }

  function isOpen() {
    return !!_base && _base.isOpen();
  }

  function open() {
    return _base_().open();
  }

  function close() {
    return _base ? _base.close() : false;
  }

  function toggle() {
    return _base_().toggle();
  }

  function focus() {
    _base?.focus();
  }

  // レールは再描画のたびに作り直されるので、描画後に開閉状態を貼り直す。
  function syncRailButton() {
    _base?.syncTriggerButtons();
  }

  window.GBQuickMemoPanel = Object.freeze({
    open,
    close,
    toggle,
    isOpen,
    focus,
    syncRailButton,
  });
})();
