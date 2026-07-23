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

  function _isCloudNarrow() {
    return window.MeldexStandaloneCloud?.isCloudMode?.() === true
      && window.matchMedia?.('(max-width: 820px)')?.matches;
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

    function setVisible(visible) {
      shell.classList.toggle('sa-options-collapsed', !visible);
      _setStoredFlag(COLLAPSED_KEY, visible ? '0' : '1');
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
      const collapsed = stored == null ? _isCloudNarrow() : stored === '1';
      setVisible(!collapsed);
    }

    function initDrag() {
      resizer?.addEventListener('pointerdown', event => {
        if (!isVisible()) return;
        event.preventDefault();
        const startWidth = panel.getBoundingClientRect().width || defaultWidth;
        const startX = event.clientX;
        const onMove = moveEvent => setWidth(startWidth + startX - moveEvent.clientX, false);
        const onUp = upEvent => {
          document.body.classList.remove('sa-resizing-option-panel');
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          setWidth(startWidth + startX - upEvent.clientX, true);
        };
        document.body.classList.add('sa-resizing-option-panel');
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
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
    applyStoredWidth();
    applyStoredVisibility();
    ensureDetailTabShell();
    window.addEventListener('resize', () => applyStoredWidth());

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
