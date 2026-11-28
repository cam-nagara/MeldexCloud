/* viewer-controls.js — Meldexビューワー: ツールバーボタン・キーボード・ホイール・マウス拡張ボタンの
   入力配線を担当する。すべて window.MeldexViewerScene / window.MeldexViewerAnnotations へ発呼するだけで、
   シーン状態そのものは保持しない（読み出しはScene側の公開APIのみを使う）。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 2. ビューワーUI」
   分割元: viewer.html（旧・単一 <script type="module"> ブロック） */
(function () {
  'use strict';

  const Scene = window.MeldexViewerScene;
  // 狭いデスクトップのサブパネルをスマホと取り違えない。実際のスマホとタッチ表示は44pxを保つ。
  function syncToolbarDensity() {
    let desktopHost = false;
    try {
      desktopHost = window.parent !== window && window.parent.innerWidth > 640
        && !window.parent.matchMedia('(pointer: coarse)').matches;
    } catch (_) { /* 別オリジンの埋め込みは、その画面自身の幅で判断する。 */ }
    if (desktopHost) document.documentElement.dataset.toolbarDensity = 'desktop';
    else delete document.documentElement.dataset.toolbarDensity;
  }
  syncToolbarDensity();
  window.addEventListener('resize', syncToolbarDensity);

  const annotationsAvailable = () => document.documentElement.dataset.viewerAnnotationCapability !== 'disabled';

  // flipHorizontal2 / flipVertical2 / rotateCw は共通アイコン置換表（meldex-core.part01.js の
  // LUCIDE マップ + replaceIcons()）へ登録済み（ビューワー残課題修正計画 2026-08-04）。
  // ボタンのアイコンは通常の DOMContentLoaded 時の replaceIcons() 経由で共通描画されるため、
  // ここでのビューワー固有の直接描画は不要（撤去）。

  // コントロール
  // 左右の端のページ送り領域は、矢印キーと同じく進む方向に従う（「左へ」なら左端で次へ）。
  const edgeTurn = side => {
    Scene.pause();
    const step = window.MeldexViewerPageState?.edgeStep?.(side, Scene.getDirection?.()) || (side === 'left' ? 'prev' : 'next');
    if (step === 'next') Scene.nextGroup(); else Scene.prevGroup();
  };
  document.getElementById('nav-prev-area').addEventListener('click', () => edgeTurn('left'));
  document.getElementById('nav-next-area').addEventListener('click', () => edgeTurn('right'));
  document.getElementById('btn-prev').onclick = () => { Scene.pause(); Scene.prevGroup(); };
  document.getElementById('btn-next').onclick = () => { Scene.pause(); Scene.nextGroup(); };
  document.getElementById('btn-shift-back').onclick = () => { Scene.pause(); Scene.shiftBackward(); };
  document.getElementById('btn-shift-fwd').onclick = () => { Scene.pause(); Scene.shiftForward(); };
  document.getElementById('btn-play').onclick = Scene.togglePlay;
  // 表示モード等の選択欄は、選んで閉じたらフォーカスを外して画面へ戻す。フォーカスが残ると、
  // 続く左右の矢印キーが選択欄の値を変え、ページ送りのつもりで表示モードが切り替わっていた。
  function releaseViewSelect(select) {
    if (select && document.activeElement === select) select.blur();
  }
  window.MeldexViewerControls = Object.assign(window.MeldexViewerControls || {}, { releaseViewSelect });
  document.getElementById('sel-mode').onchange = function() { Scene.setMode(this.value); releaseViewSelect(this); };
  document.getElementById('sel-direction').onchange = function() { Scene.setDirection(this.value); releaseViewSelect(this); };
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
  // 動画・音声を表示中は再生位置、それ以外はフォルダ内の何枚目かを動かす。
  document.getElementById('seek-bar').addEventListener('input', function() {
    if (window.MeldexViewerMediaSeek?.isMediaMode?.() && window.MeldexViewerMediaSeek.seekTo(this.value)) return;
    Scene.pause();
    Scene.goToIndex(parseInt(this.value, 10));
  });
  // アノテートボタン。本体のビューワーパネル内（iframe）では本体側に同じ入口があるため出さない
  // （常に最前面ボタンと同じ扱い）。使えないファイル（Cloudの直接オープン等）でも出さない。
  const annotationButton = document.getElementById('btn-annotation');
  if (annotationButton) {
    // iframe内では二度と出さないので取り除く（アノテートの可否が後から変わっても復活させない）。
    if (window.MeldexViewerSceneUtils?.isEmbeddedMeldexViewer?.()) annotationButton.remove();
    else if (annotationsAvailable()) annotationButton.onclick = () => window.MeldexViewerAnnotationEntry.toggle();
    else annotationButton.hidden = true;
  }
  document.getElementById('btn-prev-folder').onclick = Scene.prevFolder;
  document.getElementById('btn-next-folder').onclick = Scene.nextFolder;
  // skipBack / skipForward は共通のアイコン置換表（replaceIcons）に無い形のため、ここで直接描画する。
  document.getElementById('btn-prev-folder').innerHTML = Scene.icon('skipBack');
  document.getElementById('btn-next-folder').innerHTML = Scene.icon('skipForward');

  // 進む方向ごとの矢印キー（2026-11-27 利用者の依頼）。ページ送りは進む方向の軸、フォルダ移動は
  // それと直交する軸に置き、同じキーを2つの操作が取り合わないようにする。
  //   右へ: → 次 / ← 前、↓ 次のフォルダ / ↑ 前のフォルダ（従来どおり）
  //   左へ: ← 次 / → 前、↓ 次のフォルダ / ↑ 前のフォルダ
  //   下へ: ↓ 次 / ↑ 前、→ 次のフォルダ / ← 前のフォルダ
  //   上へ: ↑ 次 / ↓ 前、→ 次のフォルダ / ← 前のフォルダ
  // 割り当ては共通のショートカットレジストリの既定値として登録し直すため、利用者が変えたキーは保たれ、
  // 右クリックメニュー・ツールチップ・右サイドバーの一覧の表記も同じ値を使う。
  const DIRECTION_KEYS = {
    right: { forward: 'arrowright', backward: 'arrowleft', folderForward: 'arrowdown', folderBackward: 'arrowup' },
    left: { forward: 'arrowleft', backward: 'arrowright', folderForward: 'arrowdown', folderBackward: 'arrowup' },
    down: { forward: 'arrowdown', backward: 'arrowup', folderForward: 'arrowright', folderBackward: 'arrowleft' },
    up: { forward: 'arrowup', backward: 'arrowdown', folderForward: 'arrowright', folderBackward: 'arrowleft' },
  };
  // 進む・戻るのアイコン（chevron＝ページ送り、arrow＝1枚ずらし／ツールバーの前へ・次へ）。
  const DIRECTION_ICONS = {
    right: { forward: 'Right', backward: 'Left' }, left: { forward: 'Left', backward: 'Right' },
    down: { forward: 'Down', backward: 'Up' }, up: { forward: 'Up', backward: 'Down' },
  };
  function currentDirection() {
    const value = Scene.getDirection?.();
    return DIRECTION_KEYS[value] ? value : 'right';
  }
  function directionalShortcuts(direction) {
    const keys = DIRECTION_KEYS[direction] || DIRECTION_KEYS.right;
    return {
      'viewer.prevFolder':   { key: keys.folderBackward,          label: '前のフォルダ',    scope: 'viewer' },
      'viewer.nextFolder':   { key: keys.folderForward,           label: '次のフォルダ',    scope: 'viewer' },
      'viewer.shiftForward': { key: 'shift+' + keys.forward,      label: '1枚ずらして進む', scope: 'viewer' },
      'viewer.shiftBackward':{ key: 'shift+' + keys.backward,     label: '1枚ずらして戻る', scope: 'viewer' },
      'viewer.next':         { key: keys.forward,                 label: '次へ',            scope: 'viewer' },
      'viewer.prev':         { key: keys.backward,                label: '前へ',            scope: 'viewer' },
    };
  }
  function directionIcons(direction = currentDirection()) {
    const icons = DIRECTION_ICONS[direction] || DIRECTION_ICONS.right;
    return {
      next: 'chevron' + icons.forward, prev: 'chevron' + icons.backward,
      shiftForward: 'arrow' + icons.forward, shiftBackward: 'arrow' + icons.backward,
    };
  }
  function shortcutText(id) {
    const registry = window.MeldexShortcutRegistry;
    const key = registry?.keyFor?.(id) || '';
    return key && registry?.formatKey ? registry.formatKey(key) : '';
  }
  function titleWithKey(label, id) {
    const text = shortcutText(id);
    return text ? label + ' (' + text + ')' : label;
  }
  function applyDirection() {
    const direction = currentDirection();
    window.MeldexShortcutRegistry?.registerLocal(directionalShortcuts(direction));
    const icons = directionIcons(direction);
    const prev = document.getElementById('btn-prev');
    const next = document.getElementById('btn-next');
    if (prev) { prev.innerHTML = Scene.icon(icons.shiftBackward); prev.title = titleWithKey('前へ', 'viewer.prev'); }
    if (next) { next.innerHTML = Scene.icon(icons.shiftForward); next.title = titleWithKey('次へ', 'viewer.next'); }
    const prevFolder = document.getElementById('btn-prev-folder');
    const nextFolder = document.getElementById('btn-next-folder');
    if (prevFolder) prevFolder.title = titleWithKey('前のフォルダ', 'viewer.prevFolder');
    if (nextFolder) nextFolder.title = titleWithKey('次のフォルダ', 'viewer.nextFolder');
    document.documentElement.dataset.viewerDirection = direction;
    window.dispatchEvent(new CustomEvent('meldex-viewer-shortcuts-changed', { detail: { direction } }));
  }
  window.MeldexViewerControls = Object.assign(window.MeldexViewerControls || {}, { directionIcons, applyDirection });

  // キーボード（Eagle互換）
  // キーは共通のショートカットレジストリ（gb-shortcut-registry.js）へ登録し、
  // 右サイドバーの「ショートカットキー」タブから確認・変更できるようにする。
  // preventDefault の有無は従来どおり操作ごとに保つ（矢印・Space・ズームのみ抑止）。
  const VIEWER_SHORTCUTS = {
    'viewer.playPause':    { key: 'space',            label: '再生 / 一時停止',   scope: 'viewer' },
    // 前後のページ・1枚ずらし・フォルダ移動のキーは進む方向で決まる（directionalShortcuts）。
    ...directionalShortcuts(currentDirection()),
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
  applyDirection();
  window.addEventListener('viewer-direction-change', applyDirection);
  // [実行内容, 既定動作を抑止するか]
  const VIEWER_ACTIONS = {
    'viewer.playPause':     [() => Scene.togglePlay(), true],
    'viewer.prevFolder':    [() => Scene.prevFolder(), true],
    'viewer.nextFolder':    [() => Scene.nextFolder(), true],
    // キーの割り当ては進む方向で変わる（directionalShortcuts）。ここでは操作の意味だけを持つ。
    // 再生中は手動送りに合わせてスライドショーの次送りタイマーを起点からやり直す。
    // 上下の矢印キーにもなるため、ページ全体のスクロールは止める。
    'viewer.shiftForward':  [() => Scene.shiftForward(), true],
    'viewer.shiftBackward': [() => Scene.shiftBackward(), true],
    'viewer.next':          [() => { Scene.nextGroup(); Scene.rescheduleSlideshow(); }, true],
    'viewer.prev':          [() => { Scene.prevGroup(); Scene.rescheduleSlideshow(); }, true],
    'viewer.toggleHud':     [() => Scene.toggleHud(), false],
    'viewer.fullscreen':    [() => Scene.toggleFullscreen(), false],
    'viewer.reversePlay':   [() => Scene.toggleReversePlay(), false],
    'viewer.flipH':         [() => { Scene.toggleFlipH(); Scene.flashStatus('左右反転: ' + (Scene.getFlipH() ? 'ON' : 'OFF')); }, false],
    'viewer.original':      [() => { if (Scene.setOriginal()) Scene.flashStatus('原寸表示'); }, false],
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
    VIEWER_ACTIONS['viewer.annotation'] = [() => window.MeldexViewerAnnotationEntry.toggle(true), false];
  }

  // 文字入力・選択欄、右サイドバー・メニュー・ダイアログ内のキーはそれぞれの部品に任せる。
  // ツールバーのボタンにフォーカスが残っていても（再生ボタンを押した直後など）矢印キー等の
  // ビューワー操作は効かせ、Space/Enter だけはボタン自身の押下に任せる。シークバーでは
  // 矢印キー等をスライダー操作に任せる（値の変更がそのまま前後移動になる）。
  const VIEW_SELECTS = '#sel-mode, #sel-direction, #viewer-pages-mode, #viewer-pages-first';
  const RANGE_NATIVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  function shouldLeaveKeyToFocusedControl(e) {
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return false;
    if (target.isContentEditable) return true;
    if (target.closest('.sa-secondary-panel, .gb-context-menu, [role="menu"], [role="dialog"], .sa-version-overlay')) return true;
    const nativeMedia = target.closest('video[controls], audio[controls]');
    if (nativeMedia?.closest('.layer.show')) return true;
    // 表示の選択欄にフォーカスが残っていても、左右の矢印キーはページ送りにする（選択欄の値を変えない）。
    if (target.closest(VIEW_SELECTS) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) return false;
    if (target.closest('textarea, select')) return true;
    const input = target.closest('input');
    if (input) return String(input.type || '').toLowerCase() !== 'range' || RANGE_NATIVE_KEYS.has(e.key);
    if (target.closest('button')) return !target.closest('#controls') || e.key === ' ' || e.key === 'Enter';
    return false;
  }

  document.addEventListener('keydown', e => {
    if (shouldLeaveKeyToFocusedControl(e)) return;
    if (e.key === 'Escape') {
      // Esc は「閉じる」の共通操作なので変更対象にしない
      if (window.MeldexViewerAnnotations?.isActive?.()) window.MeldexViewerAnnotations.toggle();
      else if (document.fullscreenElement) document.exitFullscreen();
      return;
    }
    // 逆再生は Shift+R と区別する（従来どおり Shift 付きでは動かさない）
    if ((e.key === 'r' || e.key === 'R') && e.shiftKey) return;
    if ((e.ctrlKey || e.metaKey) && ['c', 'f'].includes(e.key.toLowerCase())) return;
    const id = window.MeldexShortcutRegistry?.matchEvent(e, ['viewer']) || '';
    const entry = VIEWER_ACTIONS[id];
    if (entry) {
      // 選択欄の既定動作（値の切替）はページ送りの時に止める
      if (entry[1] || e.target?.closest?.(VIEW_SELECTS)) e.preventDefault();
      if (e.target?.closest?.(VIEW_SELECTS)) e.target.closest(VIEW_SELECTS).blur();
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

  // タッチ後にブラウザーが生成する互換dblclickを、マウスの操作と混同しない。
  let lastContentPointerType = '';
  document.getElementById('display').addEventListener('pointerdown', e => {
    lastContentPointerType = e.pointerType;
  }, true);
  // 画像のダブルクリックは、フィット方式を維持したままズームとパンをリセットする。
  document.getElementById('display').addEventListener('dblclick', e => {
    if (lastContentPointerType === 'touch' || e.sourceCapabilities?.firesTouchEvents) return;
    if (e.target.closest('.viewer-text-layer, .nav-area, .sa-toolbar, .sa-note, button, input, select')) return;
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
    const isUi = target => !!target?.closest?.('.viewer-text-layer, .nav-area, #controls, .sa-toolbar, .sa-note, button, input, select, textarea');

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

  // マウスの戻る/進むボタン（XButton1/XButton2）は画像送りに使わない。
  // 埋め込み時は親画面へ渡し、このビューワーを開いているタブの履歴を戻る/進むにする。
  // 単独で開いた時は何もしない（ページ全体の遷移だけ止める）。
  ['mousedown', 'mouseup', 'auxclick'].forEach(eventName => {
    document.addEventListener(eventName, e => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopPropagation();
      if (eventName !== 'mouseup') return;
      try {
        if (window.parent && window.parent !== window
            && typeof window.parent.meldexPointerNavigateFromFrame === 'function') {
          window.parent.meldexPointerNavigateFromFrame(window, e.button === 3 ? -1 : 1);
        }
      } catch {}
    }, {capture: true});
  });

  // ツールバー自動表示/非表示: マウスが#display上端に近づいたら表示、離れたら短い遅延後に非表示
  // （2026-11-24 下端から上端へ移動。設定「ツールバーを自動で隠す」がオフなら常に表示）。
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
    }
    // 全アプリ共通の設定（gb-toolbar-autohide.js）。オフなら隠さない。
    const autoHideEnabled = () => !window.MeldexToolbarAutoHide || window.MeldexToolbarAutoHide.isEnabled();
    function menuOpen() {
      return !!controls.querySelector('[aria-expanded="true"]')
        || !!document.querySelector('.gb-toolbar-overflow-popup, .gb-context-menu:not([hidden])');
    }
    function hideNow() {
      if (!autoHideEnabled() || isCoarsePointer || toolbarFocused || controls.matches(':hover')) return;
      if (menuOpen()) { scheduleHide(); return; }
      controls.classList.remove('controls-active');
      syncParentAnnotationButton(false);
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideNow, HIDE_DELAY_MS);
    }

    window.showViewerToolbar = show;
    if (isCoarsePointer) { show(); return; }
    if (!autoHideEnabled()) show();
    window.addEventListener('meldex:toolbar-autohide-change', () => { if (autoHideEnabled()) scheduleHide(); else show(); });

    document.addEventListener('mousemove', (e) => {
      const rect = displayEl.getBoundingClientRect();
      const nearTop = (e.clientY - rect.top) <= PROXIMITY_PX
        && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY <= rect.bottom;
      if (nearTop) show(); else scheduleHide();
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
  } catch(e) {}
})();
