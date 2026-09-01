/* viewer-controls.js — Meldexビューワー: ツールバーボタン・キーボード・ホイール・マウス拡張ボタンの
   入力配線を担当する。すべて window.MeldexViewerScene / window.MeldexViewerAnnotations へ発呼するだけで、
   シーン状態そのものは保持しない（読み出しはScene側の公開APIのみを使う）。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 2. ビューワーUI」
   分割元: viewer.html（旧・単一 <script type="module"> ブロック） */
(function () {
  'use strict';

  const Scene = window.MeldexViewerScene;
  const annotationsAvailable = () => document.documentElement.dataset.viewerAnnotationCapability !== 'disabled';

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
  // キーは共通のショートカットレジストリ（gb-shortcut-registry.js）へ登録し、
  // 右サイドバーの「ショートカットキー」タブから確認・変更できるようにする。
  // preventDefault の有無は従来どおり操作ごとに保つ（矢印・Space・ズームのみ抑止）。
  const VIEWER_SHORTCUTS = {
    'viewer.playPause':    { key: 'space',            label: '再生 / 一時停止',   scope: 'viewer' },
    'viewer.prevFolder':   { key: 'arrowup',          label: '前のフォルダ',       scope: 'viewer' },
    'viewer.nextFolder':   { key: 'arrowdown',        label: '次のフォルダ',       scope: 'viewer' },
    'viewer.shiftForward': { key: 'shift+arrowright', label: '1枚ずらして進む',    scope: 'viewer' },
    'viewer.shiftBackward':{ key: 'shift+arrowleft',  label: '1枚ずらして戻る',    scope: 'viewer' },
    'viewer.next':         { key: 'arrowright',       label: '次へ',               scope: 'viewer' },
    'viewer.prev':         { key: 'arrowleft',        label: '前へ',               scope: 'viewer' },
    'viewer.toggleHud':    { key: 'h',                label: '情報表示の切替',     scope: 'viewer' },
    'viewer.fullscreen':   { key: 'f',                label: '全画面表示',         scope: 'viewer' },
    'viewer.reversePlay':  { key: 'r',                label: '逆再生の切替',       scope: 'viewer' },
    'viewer.flipH':        { key: 'm',                label: '左右反転',           scope: 'viewer' },
    'viewer.original':     { key: 'o',                label: '原寸表示',           scope: 'viewer' },
    'viewer.rotate':       { key: 'q',                label: '回転',               scope: 'viewer' },
    'viewer.zoomIn':       { key: '=',                label: '拡大',               scope: 'viewer' },
    'viewer.zoomOut':      { key: '-',                label: '縮小',               scope: 'viewer' },
    'viewer.fitContain':   { key: '1',                label: '画面に合わせる',     scope: 'viewer' },
    'viewer.fitHeight':    { key: '2',                label: '高さに合わせる',     scope: 'viewer' },
    'viewer.fitWidth':     { key: '3',                label: '幅に合わせる',       scope: 'viewer' },
    'viewer.fitNone':      { key: '4',                label: 'フィットしない',     scope: 'viewer' },
  };
  if (annotationsAvailable()) {
    VIEWER_SHORTCUTS['viewer.annotation'] = { key: 'a', label: 'アノテートの切替', scope: 'viewer' };
  }
  window.MeldexShortcutRegistry?.registerLocal(VIEWER_SHORTCUTS);

  // [実行内容, 既定動作を抑止するか]
  const VIEWER_ACTIONS = {
    'viewer.playPause':     [() => Scene.togglePlay(), true],
    'viewer.prevFolder':    [() => Scene.prevFolder(), true],
    'viewer.nextFolder':    [() => Scene.nextFolder(), true],
    'viewer.shiftForward':  [() => Scene.shiftForward(), true],
    'viewer.shiftBackward': [() => Scene.shiftBackward(), true],
    // マンガモードでも常に右=次、左=前。再生中は手動送りに合わせてスライドショーの
    // 次送りタイマーを起点からやり直す（元コードの `if (playing) scheduleNext()` を維持）。
    'viewer.next':          [() => { Scene.nextGroup(); Scene.rescheduleSlideshow(); }, false],
    'viewer.prev':          [() => { Scene.prevGroup(); Scene.rescheduleSlideshow(); }, false],
    'viewer.toggleHud':     [() => Scene.toggleHud(), false],
    'viewer.fullscreen':    [() => Scene.toggleFullscreen(), false],
    'viewer.reversePlay':   [() => Scene.toggleReversePlay(), false],
    'viewer.flipH':         [() => { Scene.toggleFlipH(); Scene.flashStatus('左右反転: ' + (Scene.getFlipH() ? 'ON' : 'OFF')); }, false],
    'viewer.original':      [() => { Scene.setOriginal(); Scene.flashStatus('原寸表示'); }, false],
    'viewer.rotate':        [() => { Scene.rotate(); Scene.flashStatus('回転: ' + Scene.getRotateDeg() + '°'); }, false],
    'viewer.zoomIn':        [() => Scene.zoomIn(), true],
    'viewer.zoomOut':       [() => Scene.zoomOut(), true],
    'viewer.fitOriginalContain': [() => Scene.setFitMode('original_contain'), false],
    'viewer.fitContain':    [() => Scene.setFitMode('contain'), false],
    'viewer.fitHeight':     [() => Scene.setFitMode('height'), false],
    'viewer.fitWidth':      [() => Scene.setFitMode('width'), false],
    'viewer.fitNone':       [() => Scene.setFitMode('none'), false],
  };
  if (annotationsAvailable()) {
    VIEWER_ACTIONS['viewer.annotation'] = [() => window.MeldexViewerAnnotations?.toggleFromShortcut?.(), false];
  }

  document.addEventListener('keydown', e => {
    const target = e.target;
    if (target && (target.closest('input, textarea, select, button') || target.isContentEditable)) return;
    if (e.key === 'Escape') {
      // Esc は「閉じる」の共通操作なので変更対象にしない
      if (window.MeldexViewerAnnotations?.isActive?.()) window.MeldexViewerAnnotations.toggle();
      else if (document.fullscreenElement) document.exitFullscreen();
      return;
    }
    // 逆再生は Shift+R と区別する（従来どおり Shift 付きでは動かさない）
    if ((e.key === 'r' || e.key === 'R') && e.shiftKey) return;
    const id = window.MeldexShortcutRegistry?.matchEvent(e, ['viewer']) || '';
    const entry = VIEWER_ACTIONS[id];
    if (entry) {
      if (entry[1]) e.preventDefault();
      entry[0]();
      return;
    }
    // 別名キー（0 は 1 と同じ、+ は = と同じ）。レジストリには片方だけ載せる。
    if (e.key === '0') Scene.setFitMode('contain');
    else if (e.key === '+') { e.preventDefault(); Scene.zoomIn(); }
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

  // 画像のダブルクリックは、フィット方式を維持したままズームとパンをリセットする。
  document.getElementById('display').addEventListener('dblclick', e => {
    if (e.target.closest('.nav-area, .sa-toolbar, .sa-note, button, input, select')) return;
    e.preventDefault();
    Scene.resetZoom();
  });

  // タッチ操作。2本指は同一ジェスチャー中にズーム・パン・回転を同時適用し、
  // 1本指は短いスワイプ／ダブルタップだけに限定する（1本指パンとページ送りの競合を避ける）。
  (function installTouchGestures() {
    const display = document.getElementById('display');
    if (!display || typeof PointerEvent === 'undefined') return;
    const points = new Map();
    let pair = null;
    let singleStart = null;
    let lastTap = null;

    const snapshotPair = () => {
      const values = [...points.values()];
      if (values.length < 2) return null;
      const a = values[0], b = values[1];
      return {
        centerX: (a.x + b.x) / 2,
        centerY: (a.y + b.y) / 2,
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
        zoom: Scene.getZoom(),
        rotate: Scene.getRotateDeg(),
      };
    };
    const isUi = target => !!target?.closest?.('.nav-area, #controls, .sa-toolbar, .sa-note, button, input, select, textarea');

    display.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || isUi(e.target) || window.MeldexViewerAnnotations?.isActive?.()) return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { display.setPointerCapture(e.pointerId); } catch {}
      if (points.size === 1) singleStart = { x: e.clientX, y: e.clientY, time: performance.now(), pointerId: e.pointerId };
      if (points.size === 2) { pair = snapshotPair(); singleStart = null; }
    });
    display.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch' || !points.has(e.pointerId)) return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size < 2 || !pair) return;
      e.preventDefault();
      const next = snapshotPair();
      if (!next) return;
      Scene.setZoomAt(next.centerX, next.centerY, pair.zoom * (next.distance / pair.distance));
      Scene.panBy(next.centerX - pair.centerX, next.centerY - pair.centerY);
      // atan2 は +180°/-180° の境界で値が反転する。単純な差分だと指を数度
      // 動かしただけで約360°回転するため、常に最短角の増分へ正規化する。
      const angleDelta = ((next.angle - pair.angle + 540) % 360) - 180;
      Scene.setRotateDeg(pair.rotate + angleDelta);
      // 増分中心を更新しつつ、倍率・回転の基準値は現在値へ追随させる。
      pair = { ...next, zoom: Scene.getZoom(), rotate: Scene.getRotateDeg() };
    }, { passive: false });

    function finishTouch(e, cancelled) {
      if (!points.has(e.pointerId)) return;
      const end = points.get(e.pointerId);
      points.delete(e.pointerId);
      if (points.size < 2) pair = null;
      if (cancelled || !singleStart || singleStart.pointerId !== e.pointerId || !end) { singleStart = null; return; }
      const dx = end.x - singleStart.x, dy = end.y - singleStart.y;
      const elapsed = performance.now() - singleStart.time;
      const distance = Math.hypot(dx, dy);
      if (elapsed <= 500 && distance >= 64) {
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          Scene.pause();
          if (dx < 0) Scene.nextGroup(); else Scene.prevGroup();
        } else if (dy < 0) {
          window.showViewerToolbar?.();
        } else {
          returnToSourceFolder();
        }
        lastTap = null;
      } else if (elapsed <= 350 && distance <= 18) {
        const now = performance.now();
        if (lastTap && now - lastTap.time <= 360 && Math.hypot(end.x - lastTap.x, end.y - lastTap.y) <= 28) {
          Scene.getZoom() > 1.05 ? Scene.resetZoom() : Scene.setZoomAt(end.x, end.y, 2);
          lastTap = null;
        } else lastTap = { x: end.x, y: end.y, time: now };
      }
      singleStart = null;
    }
    display.addEventListener('pointerup', e => finishTouch(e, false));
    display.addEventListener('pointercancel', e => finishTouch(e, true));

    function returnToSourceFolder() {
      try {
        if (window.parent && window.parent !== window) {
          if (typeof window.parent.navGoBack === 'function' && window.parent.navGoBack()) return;
          const path = Scene.currentPath?.() || '';
          const folder = String(path).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
          if (folder && typeof window.parent.openFolder === 'function') window.parent.openFolder(folder.split('/').pop() || folder, folder);
        }
      } catch {}
    }
  })();

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

    function syncParentAnnotationButton(visible) {
      try {
        if (!window.parent || window.parent === window) return;
        const button = window.parent.document.getElementById('btn-tb-annotation');
        if (!button) return;
        button.style.opacity = visible ? '' : '0';
        button.style.pointerEvents = visible ? '' : 'none';
        button.setAttribute('aria-hidden', visible ? 'false' : 'true');
      } catch {}
    }
    function show() {
      clearTimeout(hideTimer);
      controls.classList.add('controls-active');
      syncParentAnnotationButton(true);
      if (isCoarsePointer) hideTimer = setTimeout(hideNow, 2600);
    }
    function hideNow() {
      if (toolbarFocused || controls.matches(':hover')) return;
      controls.classList.remove('controls-active');
      syncParentAnnotationButton(false);
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideNow, isCoarsePointer ? 2600 : HIDE_DELAY_MS);
    }

    window.showViewerToolbar = show;
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
    window.addEventListener('pagehide', () => syncParentAnnotationButton(true));
  })();

  // 親ウィンドウのテーマ色を継承（meldex-core.js提供）
  try {
    if (typeof inheritParentTheme === 'function') inheritParentTheme();
    const bg2 = getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim() || '#111419';
    document.documentElement.style.setProperty('--panel-bg', bg2 + 'ee');
  } catch(e) {}
})();
