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
  const MIN_W = 300;
  const MIN_H = 320;
  const DEFAULT_W = 420;
  const DEFAULT_H = 620;
  const MARGIN = 8;

  let _frame = null;
  let _base = null;
  let _handoffClosing = false;
  let _closePromise = null;

  function _icon(name, size) {
    return (typeof lucide === 'function') ? lucide(name, size || 16) : '';
  }

  function _isCloudHost() {
    return document.body?.dataset?.cloudMode === 'dropbox'
      || window.apiFetch?._meldexStandaloneCloudAdapter === true;
  }

  function _frameUrl() {
    return _isCloudHost()
      ? 'apps/quick-memo/index.html?embed=1&host=meldex-cloud'
      : 'quick-memo.html?embed=1&host=meldex-desktop';
  }

  function _standaloneWindowRect() {
    const rect = _base?.getElement?.()?.getBoundingClientRect?.();
    return {
      width: Math.max(MIN_W, Math.round(rect?.width || DEFAULT_W)),
      height: Math.max(MIN_H, Math.round(rect?.height || DEFAULT_H)),
    };
  }

  async function _openStandalone() {
    const api = _frame?.contentWindow?.MeldexQuickMemo;
    if (!api) throw new Error('クイックメモの準備が完了していません');
    if (api.prepareClose && !(await api.prepareClose())) throw new Error('音声入力を確定できないため、単独アプリを開きませんでした');
    if (typeof api.flush === 'function' && !(await api.flush())) {
      throw new Error('クイックメモを保存できなかったため、単独アプリを開きませんでした');
    }

    const size = _standaloneWindowRect();
    const url = new URL(_isCloudHost() ? 'apps/quick-memo/' : 'quick-memo.html', location.href);
    const path = String(api.currentPath?.() || '').trim();
    if (path) url.searchParams.set('open', path);
    url.searchParams.set('window_width', String(size.width));
    url.searchParams.set('window_height', String(size.height));

    let opened = false;
    if (typeof _open_app_window_js === 'function') {
      opened = await _open_app_window_js(url.toString());
    } else {
      opened = !!window.open(
        url.toString(),
        '_blank',
        `width=${size.width},height=${size.height},menubar=no,toolbar=no,location=no`,
      );
    }
    if (!opened) throw new Error('単独アプリを開けませんでした');
    _handoffClosing = true;
    try {
      close();
    } finally {
      _handoffClosing = false;
    }
    return true;
  }

  // 録音・文字起こしと端末下書きの確定を待ってからiframeを破棄する。
  async function _flushFrame() {
    try {
      const child = _frame?.contentWindow;
      if (child?.MeldexStandaloneCloseGuard?.prepareClose) {
        return await child.MeldexStandaloneCloseGuard.prepareClose('host-panel');
      }
      const api = child?.MeldexQuickMemo;
      return api?.flush ? await api.flush() : true;
    } catch (error) {
      if (typeof showStatus === 'function') showStatus(error?.message || 'クイックメモを保存できませんでした', true);
      return false;
    }
  }

  function _onEscape(event) {
    if (event.key !== 'Escape' || !isOpen()) return;
    if (!_base?.getElement?.()?.contains(document.activeElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
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
    header.querySelector('[data-role="standalone"]').addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await _openStandalone();
      } catch (error) {
        if (typeof showStatus === 'function') showStatus(error?.message || '単独アプリを開けませんでした', true);
      }
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
    frame.src = _frameUrl();
    frame.addEventListener('load', () => {
      // iframe内のキーイベントは親へ伝播しない。メニュー・ダイアログが
      // 消費しなかったEscapeだけ、同じ保存付き閉じる経路へ渡す。
      try { frame.contentDocument?.addEventListener('keydown', event => {
        if (!event.defaultPrevented && _frame === frame) _onEscape(event);
      }); } catch {}
    });
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
      mobileSheet: true,
      mobileBreakpoint: 1024,
      anchorSelector: '.gb-dock-fixed-right',
      triggerSelectors: '.gb-dock-rail-quick-memo',
      buildHeader: _buildHeader,
      buildBody: _buildBody,
      onDragToggle: (enabled) => { if (_frame) _frame.style.pointerEvents = enabled ? '' : 'none'; },
      onFocus: () => { try { _frame?.contentWindow?.focus?.(); } catch {} },
      onClose: () => {
        document.removeEventListener('keydown', _onEscape, true);
        _frame = null;
      },
    });
    return _base;
  }

  function isOpen() {
    return !!_base && _base.isOpen();
  }

  function open() {
    document.addEventListener('keydown', _onEscape, true);
    return _base_().open();
  }

  function close() {
    if (!isOpen()) return false;
    if (_handoffClosing) return _base.close();
    if (_closePromise) return _closePromise;
    const frame = _frame;
    _closePromise = (async () => {
      if (!await _flushFrame() || frame !== _frame) return false;
      return _base.close();
    })().finally(() => { _closePromise = null; });
    return _closePromise;
  }

  function toggle() {
    return isOpen() ? close() : open();
  }

  function focus() {
    _base?.focus();
  }

  function _versionApiFor(path) {
    const api = _frame?.contentWindow?.MeldexQuickMemo;
    const target = api?.currentVersionTarget?.();
    const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    return api && target?.path && normalize(target.path) === normalize(path) ? api : null;
  }

  async function flushVersionTarget(path) {
    const api = _versionApiFor(path);
    if (!api) return false;
    if (api.prepareClose && !(await api.prepareClose())) throw new Error('音声入力を確定できないため、バージョン操作を中止しました');
    if (typeof api.flush === 'function' && !(await api.flush())) {
      throw new Error('クイックメモを保存できないため、バージョン操作を中止しました');
    }
    return true;
  }

  async function reloadVersionTarget(path) {
    const api = _versionApiFor(path);
    if (!api || typeof api.reloadCurrentVersion !== 'function') return false;
    await api.reloadCurrentVersion();
    return true;
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
    flushVersionTarget,
    reloadVersionTarget,
  });
})();
