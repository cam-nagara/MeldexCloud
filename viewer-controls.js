/* viewer-controls.js — Meldexビューワー: ツールバーボタン・キーボード・ホイール・マウス拡張ボタンの
   入力配線を担当する。すべて window.MeldexViewerScene / window.MeldexViewerAnnotations へ発呼するだけで、
   シーン状態そのものは保持しない（読み出しはScene側の公開APIのみを使う）。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 2. ビューワーUI」
   分割元: viewer.html（旧・単一 <script type="module"> ブロック） */
(function () {
  'use strict';

  const Scene = window.MeldexViewerScene;

  // flipHorizontal2 / flipVertical2 / rotateCw は共通アイコン置換表（meldex-core.part01.js の
  // LUCIDE マップ + replaceIcons()）へ登録済み（ビューワー残課題修正計画 2026-08-04）。
  // ボタンのアイコンは通常の DOMContentLoaded 時の replaceIcons() 経由で共通描画されるため、
  // ここでのビューワー固有の直接描画は不要（撤去）。

  // コントロール
  document.getElementById('nav-prev-area').addEventListener('click', () => { Scene.pause(); Scene.prevGroup(); });
  document.getElementById('nav-next-area').addEventListener('click', () => { Scene.pause(); Scene.nextGroup(); });
  document.getElementById('btn-prev').onclick = () => { Scene.pause(); Scene.prevGroup(); };
  document.getElementById('btn-next').onclick = () => { Scene.pause(); Scene.nextGroup(); };
  document.getElementById('btn-shift-back').onclick = () => { Scene.pause(); Scene.shiftBackward(); };
  document.getElementById('btn-shift-fwd').onclick = () => { Scene.pause(); Scene.shiftForward(); };
  document.getElementById('btn-play').onclick = Scene.togglePlay;
  document.getElementById('sel-mode').onchange = function() { Scene.setMode(this.value); };
  document.getElementById('speed').oninput = function() { Scene.setSpeed(this.value); };
  document.getElementById('btn-bg').onclick = Scene.toggleBg;
  document.getElementById('btn-fullscreen').onclick = Scene.toggleFullscreen;
  document.getElementById('btn-hud').onclick = Scene.toggleHud;
  document.getElementById('btn-zoom-in').onclick = Scene.zoomIn;
  document.getElementById('btn-zoom-out').onclick = Scene.zoomOut;
  document.getElementById('btn-fit').onclick = Scene.cycleFit;
  document.getElementById('btn-original').onclick = Scene.setOriginal;
  document.getElementById('btn-flip-h').onclick = Scene.toggleFlipH;
  document.getElementById('btn-flip-v').onclick = Scene.toggleFlipV;
  document.getElementById('btn-rotate').onclick = Scene.rotate;
  document.getElementById('seek-bar').addEventListener('input', function() { Scene.pause(); Scene.goToIndex(parseInt(this.value, 10)); });
  document.getElementById('btn-prev-folder').onclick = Scene.prevFolder;
  document.getElementById('btn-next-folder').onclick = Scene.nextFolder;

  // キーボード（Eagle互換）
  document.addEventListener('keydown', e => {
    const target = e.target;
    if (target && (target.closest('input, textarea, select, button') || target.isContentEditable)) return;
    if (e.code === 'Space') { e.preventDefault(); Scene.togglePlay(); }
    // 上下矢印: フォルダ移動
    else if (e.key === 'ArrowUp') { e.preventDefault(); Scene.prevFolder(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); Scene.nextFolder(); }
    // Shift+矢印: 1枚ずつシフト
    else if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); Scene.shiftForward(); }
    else if (e.key === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); Scene.shiftBackward(); }
    // 矢印: グループ送り（マンガモードでも常に右=次、左=前）。再生中は手動送りに合わせて
    // スライドショーの次送りタイマーを起点からやり直す（元コードの `if (playing) scheduleNext()` を維持）。
    else if (e.key === 'ArrowRight') { Scene.nextGroup(); Scene.rescheduleSlideshow(); }
    else if (e.key === 'ArrowLeft') { Scene.prevGroup(); Scene.rescheduleSlideshow(); }
    // H: HUD表示トグル
    else if (e.key === 'h' || e.key === 'H') { Scene.toggleHud(); }
    // F: フルスクリーン
    else if (e.key === 'f' || e.key === 'F') { Scene.toggleFullscreen(); }
    // R: 逆再生トグル
    else if (e.key === 'r' || e.key === 'R') { if (!e.shiftKey) Scene.toggleReversePlay(); }
    else if (e.key === 'm' || e.key === 'M') { Scene.toggleFlipH(); Scene.flashStatus('左右反転: ' + (Scene.getFlipH() ? 'ON' : 'OFF')); }
    else if (e.key === 'o' || e.key === 'O') { Scene.setOriginal(); Scene.flashStatus('原寸表示'); }
    else if (e.key === 'q' || e.key === 'Q') { Scene.rotate(); Scene.flashStatus('回転: ' + Scene.getRotateDeg() + '°'); }
    // +/-: ズーム
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); Scene.zoomIn(); }
    else if (e.key === '-') { e.preventDefault(); Scene.zoomOut(); }
    // 0-4: フィットモード切替
    else if (e.key === '0' || e.key === '1') { Scene.setFitMode('contain'); }
    else if (e.key === '2') { Scene.setFitMode('height'); }
    else if (e.key === '3') { Scene.setFitMode('width'); }
    else if (e.key === '4') { Scene.setFitMode('none'); }
    // A: 注釈トグル（描画中は誤爆させない）。単独ビューワーの公開注釈コマンド入口の一つ。
    else if (e.key === 'a' || e.key === 'A') { window.MeldexViewerAnnotations?.toggleFromShortcut?.(); }
    else if (e.key === 'Escape') {
      if (window.MeldexViewerAnnotations?.isActive?.()) { window.MeldexViewerAnnotations.toggle(); }
      else if (document.fullscreenElement) document.exitFullscreen();
    }
  });

  // ホイール: 設定（gb:viewer-wheel-mode。'zoom'既定 | 'nav'）でズーム/前後移動を切替する
  // （ビューワー残課題修正計画 2026-08-04「3. ホイール動作の設定対応」）。ズーム時はカーソル位置を
  // 中心にズームする（zoomAt。item 2）。他ウィンドウ（親の設定ダイアログ等）での変更は
  // storageイベントで即時反映する。
  let wheelMode = localStorage.getItem('gb:viewer-wheel-mode') || 'zoom';
  window.addEventListener('storage', (e) => {
    if (e.key === 'gb:viewer-wheel-mode') wheelMode = e.newValue || 'zoom';
  });
  document.getElementById('display').addEventListener('wheel', e => {
    e.preventDefault();
    if (wheelMode === 'nav') {
      Scene.pause();
      if (e.deltaY > 0) Scene.nextGroup(); else Scene.prevGroup();
      return;
    }
    Scene.zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 'out' : 'in');
  }, {passive: false});

  // マウスの戻る/進むボタン（XButton1/XButton2）で前後へ移動
  ['mousedown', 'mouseup', 'auxclick'].forEach(eventName => {
    document.addEventListener(eventName, e => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopPropagation();
      if (eventName !== 'mousedown') return;
      Scene.pause();
      if (e.button === 3) Scene.prevGroup();
      else Scene.nextGroup();
    }, {capture: true});
  });

  // ツールバー自動表示/非表示: マウスが#display下端に近づいたら表示、離れたら短い遅延後に非表示。
  // ツールバー内にフォーカス/ホバーがある間は隠さない。pointer:coarse環境（タッチ）では常時表示
  // （embed=1専用だった旧hover制御・再生中3秒非表示の旧ロジックはこの方式に統一。
  // ビューワー残課題修正計画 2026-08-04「6. ツールバーの自動表示/非表示」）。
  (function () {
    const controls = document.getElementById('controls');
    const displayEl = document.getElementById('display');
    if (!controls || !displayEl) return;
    const isCoarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const PROXIMITY_PX = 72;
    const HIDE_DELAY_MS = 600;
    let hideTimer = 0;
    let toolbarFocused = false;

    function show() {
      clearTimeout(hideTimer);
      controls.classList.add('controls-active');
    }
    function scheduleHide() {
      if (isCoarsePointer) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (toolbarFocused || controls.matches(':hover')) return;
        controls.classList.remove('controls-active');
      }, HIDE_DELAY_MS);
    }

    if (isCoarsePointer) { show(); return; }

    document.addEventListener('mousemove', (e) => {
      const rect = displayEl.getBoundingClientRect();
      const nearBottom = (rect.bottom - e.clientY) <= PROXIMITY_PX
        && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top;
      if (nearBottom) show(); else scheduleHide();
    });
    controls.addEventListener('mouseenter', show);
    controls.addEventListener('mouseleave', scheduleHide);
    controls.addEventListener('focusin', () => { toolbarFocused = true; show(); });
    controls.addEventListener('focusout', () => { toolbarFocused = false; scheduleHide(); });
  })();

  // 親ウィンドウのテーマ色を継承（meldex-core.js提供）
  try {
    if (typeof inheritParentTheme === 'function') inheritParentTheme();
    const bg2 = getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim() || '#252525';
    document.documentElement.style.setProperty('--panel-bg', bg2 + 'ee');
  } catch(e) {}
})();
