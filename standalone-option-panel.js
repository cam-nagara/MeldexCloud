/* standalone-option-panel.js
 * 単独アプリ（ノート/シナリオ/シート/タイマー）共通の右サイドバー（オプションパネル）枠。
 *
 * ボード単独版（board-standalone-app.js の _setRightSidebarWidth / _setOptionsPanelVisible /
 * _initStandaloneLayoutControls 相当）の実装パターンを、ボード以外の単独アプリ向けに
 * 汎用化したもの。ボード自体はこのモジュールを使わず、既存実装のまま動作する
 * （回帰リスクを避けるため。挙動は同じ考え方で揃えている）。
 *
 * 期待するHTML構造（*-standalone.html 側）:
 *   <div class="sa-shell ...">
 *     <header class="sa-toolbar">...</header>
 *     <div class="sa-body">
 *       <main class="sa-main ...">...</main>
 *       <div class="sa-option-resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
 *       <aside class="sa-option-panel" aria-label="オプションパネル">
 *         <div class="sa-option-header"><span>オプション</span></div>
 *         <div id="rp-detail" class="sa-option-body"></div>
 *       </aside>
 *     </div>
 *   </div>
 *
 * 使い方（各アプリのブートストラップJSから1回呼ぶ）:
 *   MeldexStandaloneOptionPanel.init({
 *     storagePrefix: 'meldex-note',   // localStorageキーの接頭辞（アプリごとに分離）
 *     toggleButtonIds: ['note-option-panel-button'],
 *     defaultWidth: 360,
 *   });
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  function _clampNumber(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(max, num));
  }

  function _storedNumber(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      // localStorageに未保存（null）の場合に Number(null) === 0 を「保存済みの0」と
      // 誤認しないよう、raw が無い場合は明示的に fallback を返す
      // （board-standalone-app.js の同名ヘルパーにも同種の初回幅バグがあるが、
      // 本ファイルは新規ファイルのため別ファイルとして直接修正する）。
      if (raw === null || raw === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function _storedFlag(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function _setStoredFlag(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* localStorage不可の環境では状態復元を諦める */ }
  }

  function _isNarrow() {
    return window.matchMedia?.('(max-width: 820px)')?.matches === true;
  }

  function createOptionPanel(options) {
    const opts = options || {};
    const shell = document.querySelector(opts.shellSelector || '.sa-shell');
    const panel = shell?.querySelector('.sa-option-panel');
    const resizer = shell?.querySelector('.sa-option-resizer');
    if (!shell || !panel) {
      console.error('standalone-option-panel.js: .sa-shell / .sa-option-panel が見つかりません');
      return null;
    }
    const storagePrefix = String(opts.storagePrefix || 'meldex-standalone');
    const COLLAPSED_KEY = storagePrefix + '-options-collapsed';
    const WIDTH_KEY = storagePrefix + '-option-width';
    const defaultWidth = Number(opts.defaultWidth) || 360;
    const onVisibilityChange = typeof opts.onVisibilityChange === 'function' ? opts.onVisibilityChange : null;
    const onWidthChange = typeof opts.onWidthChange === 'function' ? opts.onWidthChange : null;
    const detailContainerId = opts.detailContainerId === false ? null : (opts.detailContainerId || 'rp-detail');

    function maxWidth() {
      return Math.max(280, Math.min(760, window.innerWidth - 320));
    }

    function isVisible() {
      return !shell.classList.contains('sa-options-collapsed');
    }

    function setWidth(width, persist) {
      const next = _clampNumber(width, 260, maxWidth());
      shell.style.setProperty('--sa-option-width', Math.round(next) + 'px');
      if (persist) _setStoredFlag(WIDTH_KEY, String(Math.round(next)));
      onWidthChange?.(next);
    }

    function applyStoredWidth() {
      setWidth(_storedNumber(WIDTH_KEY, defaultWidth), false);
    }

    function setVisible(visible, persist = true) {
      shell.classList.toggle('sa-options-collapsed', !visible);
      if (persist) _setStoredFlag(COLLAPSED_KEY, visible ? '0' : '1');
      (opts.toggleButtonIds || []).forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
        btn.title = visible ? 'オプションを閉じる' : 'オプションを開く';
        btn.setAttribute('aria-label', visible ? 'オプションを閉じる' : 'オプションを開く');
      });
      onVisibilityChange?.(visible);
    }

    function toggle() {
      setVisible(!isVisible());
    }

    function applyStoredVisibility() {
      const stored = _storedFlag(COLLAPSED_KEY);
      // 狭幅では編集面を最優先し、以前のデスクトップ表示状態にかかわらず閉じて開始する。
      // この自動クローズはデスクトップ用の保存状態を上書きしない。
      const collapsed = _isNarrow() || stored === '1';
      setVisible(!collapsed, false);
    }

    function initDrag() {
      resizer?.addEventListener('pointerdown', event => {
        if (!isVisible()) return;
        event.preventDefault();
        const startWidth = panel.getBoundingClientRect().width || defaultWidth;
        const startX = event.clientX;
        const onMove = moveEvent => setWidth(startWidth + startX - moveEvent.clientX, false);
        const finish = (upEvent, persist) => {
          document.body.classList.remove('sa-resizing-option-panel');
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onCancel);
          if (persist) setWidth(startWidth + startX - upEvent.clientX, true);
        };
        const onUp = upEvent => finish(upEvent, true);
        const onCancel = cancelEvent => finish(cancelEvent, false);
        document.body.classList.add('sa-resizing-option-panel');
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onCancel);
      });
      resizer?.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const current = panel.getBoundingClientRect().width || _storedNumber(WIDTH_KEY, defaultWidth);
        setWidth(current + (event.key === 'ArrowLeft' ? 16 : -16), true);
      });
    }

    function bindToggleButtons() {
      (opts.toggleButtonIds || []).forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => toggle());
      });
    }

    function bindCloseButton() {
      const header = panel.querySelector?.('.sa-option-header');
      if (!header || header.querySelector?.('[data-standalone-option-close]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-btn gb-btn-icon sa-option-close';
      button.dataset.standaloneOptionClose = '1';
      button.dataset.e2eId = 'standalone-option-close';
      button.title = 'オプションを閉じる';
      button.setAttribute('aria-label', 'オプションを閉じる');
      button.style.minWidth = '44px';
      button.style.minHeight = '44px';
      button.innerHTML = typeof window.lucide === 'function'
        ? window.lucide('x', 16)
        : '<span class="ico ico-x" aria-hidden="true"></span>';
      button.addEventListener('click', () => setVisible(false));
      header.appendChild(button);
    }

    function bindEscapeClose() {
      document.addEventListener?.('keydown', event => {
        if (event.key !== 'Escape' || !isVisible()) return;
        if (document.querySelector('.modal-overlay, [role="dialog"][aria-modal="true"]')) return;
        event.preventDefault();
        setVisible(false);
        const button = (opts.toggleButtonIds || [])
          .map(id => document.getElementById(id))
          .find(Boolean);
        try { button?.focus?.({ preventScroll: true }); } catch (error) { button?.focus?.(); }
      });
    }

    function ensureDetailTabShell() {
      // gb-detail-panel.js（本体のオプションパネル描画エンジン）が同梱されていれば、
      // タブの入れ物だけを先に用意しておく。中身（本体タブの実データ表示）は
      // 各アプリの本体機能パリティ作業（Phase 1以降）で switchDetailTab 等から充実させる。
      if (!detailContainerId || typeof window._ensureDetailTabShell !== 'function') return;
      const el = document.getElementById(detailContainerId);
      if (el) window._ensureDetailTabShell(el);
    }

    initDrag();
    bindToggleButtons();
    bindCloseButton();
    bindEscapeClose();
    applyStoredWidth();
    applyStoredVisibility();
    ensureDetailTabShell();
    let wasNarrow = _isNarrow();
    if (wasNarrow && isVisible()) setVisible(false, false);
    window.addEventListener('resize', () => {
      const narrow = _isNarrow();
      applyStoredWidth();
      if (!wasNarrow && narrow && isVisible()) setVisible(false, false);
      wasNarrow = narrow;
    });

    return {
      toggle,
      setVisible,
      isVisible,
      setWidth,
      shell,
      panel,
    };
  }

  window.MeldexStandaloneOptionPanel = {
    init: createOptionPanel,
  };
})();
