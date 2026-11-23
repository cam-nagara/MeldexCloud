/* viewer-context-menu.js — 共通MeldexContextMenuUIを使うビューワー右クリック/長押しメニュー。 */
(function () {
  'use strict';

  const Scene = () => window.MeldexViewerScene;
  const Annotations = () => window.MeldexViewerAnnotations;
  const sep = () => ({ type: 'separator' });
  const annotationsAvailable = () => document.documentElement.dataset.viewerAnnotationCapability !== 'disabled';
  // アノテートのバージョン管理は単独ウィンドウのビューワーだけで開く（本体のパネル内では
  // 本体のアノテートパネルにバージョン管理がある）。以前は下端ツールバーのボタンだった。
  const annotationVersionsAvailable = () => window.parent === window
    && typeof window.MeldexStandaloneVersionHistory?.openViewerAnnotations === 'function';

  function openAnnotationVersions() {
    Promise.resolve()
      .then(() => window.MeldexStandaloneVersionHistory.openViewerAnnotations())
      .catch(error => window.alert(String(error?.message || error)));
  }

  function items() {
    const scene = Scene();
    return [
      ...(window.MeldexViewerScreenshotSource?.menuItems?.() || []),
      ...(window.MeldexViewerOcr?.menuItems?.() || []),
      { label: '前へ', icon: 'chevronLeft', shortcutId: 'viewer.prev', action: () => { scene.pause(); scene.prevGroup(); } },
      { label: '次へ', icon: 'chevronRight', shortcutId: 'viewer.next', action: () => { scene.pause(); scene.nextGroup(); } },
      { label: '1枚戻る', icon: 'arrowLeft', shortcutId: 'viewer.shiftBackward', action: () => { scene.pause(); scene.shiftBackward(); } },
      { label: '1枚進む', icon: 'arrowRight', shortcutId: 'viewer.shiftForward', action: () => { scene.pause(); scene.shiftForward(); } },
      sep(),
      { label: scene.isSheetContext() ? '前の画像行' : '前のフォルダ', icon: 'folderInput', shortcutId: 'viewer.prevFolder', action: () => scene.prevFolder() },
      { label: scene.isSheetContext() ? '次の画像行' : '次のフォルダ', icon: 'folderOutput', shortcutId: 'viewer.nextFolder', action: () => scene.nextFolder() },
      sep(),
      { label: scene.isPlaying() ? '一時停止' : '再生', icon: scene.isPlaying() ? 'pause' : 'play', shortcutId: 'viewer.playPause', action: () => scene.togglePlay() },
      sep(),
      { label: 'ズームイン', icon: 'zoomIn', shortcutId: 'viewer.zoomIn', action: () => scene.zoomIn() },
      { label: 'ズームアウト', icon: 'zoomOut', shortcutId: 'viewer.zoomOut', action: () => scene.zoomOut() },
      { label: 'フィット', icon: 'scan', items: [
        { label: '原寸（収める）', icon: 'scan', shortcutId: 'viewer.fitOriginalContain', action: () => scene.setFitMode('original_contain') },
        { label: '全体フィット', icon: 'maximize2', shortcutId: 'viewer.fitContain', action: () => scene.setFitMode('contain') },
        { label: '高さフィット', icon: 'moveVertical', shortcutId: 'viewer.fitHeight', action: () => scene.setFitMode('height') },
        { label: '幅フィット', icon: 'moveHorizontal', shortcutId: 'viewer.fitWidth', action: () => scene.setFitMode('width') },
        { label: '原寸', icon: 'image', shortcutId: 'viewer.fitNone', action: () => scene.setFitMode('none') },
      ] },
      { label: '全画面', icon: 'maximize', shortcutId: 'viewer.fullscreen', action: () => scene.toggleFullscreen() },
      sep(),
      { label: '表示モード', icon: 'layout', items: [
        { label: `${scene.getMode() === 'single' ? '● ' : ''}単体`, icon: 'rectangleHorizontal', action: () => scene.setMode('single') },
        { label: `${scene.getMode() === 'spread' ? '● ' : ''}見開き`, icon: 'bookOpen', action: () => scene.setMode('spread') },
        { label: `${scene.getMode() === 'manga' ? '● ' : ''}マンガ（右→左）`, icon: 'bookOpenText', action: () => scene.setMode('manga') },
      ] },
      { label: '回転・反転', icon: 'rotateCw', items: [
        { label: '左右反転', icon: 'flipHorizontal', shortcutId: 'viewer.flipH', action: () => scene.toggleFlipH() },
        { label: '上下反転', icon: 'flipVertical', action: () => scene.toggleFlipV() },
        { label: '回転', icon: 'rotateCw', shortcutId: 'viewer.rotate', action: () => scene.rotate() },
      ] },
      sep(),
      { type: 'slider', label: '再生速度', min: 0.5, max: 15, step: 0.5, value: scene.getSpeed(),
        format: value => `${parseFloat(value).toFixed(1)}s`, onChange: value => scene.setSpeed(value) },
      { type: 'slider', label: 'フェード', min: 0, max: 2000, step: 100, value: scene.getFadeMs(),
        format: value => `${(parseFloat(value) / 1000).toFixed(1)}s`, onChange: value => scene.setFadeMs(value) },
      sep(),
      { label: 'エフェクト', icon: 'sparkles', items: [
        { label: `背景ブラー ${scene.isBgBlur() ? 'ON' : 'OFF'}`, icon: 'blend', action: () => scene.toggleBg() },
        { label: `HUD ${scene.isHudVisible() ? 'ON' : 'OFF'}`, icon: 'panelTop', shortcutId: 'viewer.toggleHud', action: () => scene.toggleHud() },
      ] },
      ...(annotationsAvailable() ? [
        sep(),
        ...(window.MeldexViewerHighlights?.menuItems() || []),
        { label: 'アノテート', icon: 'penTool', shortcutId: 'viewer.annotation', action: () => Annotations()?.toggle?.() },
        ...(annotationVersionsAvailable() ? [
          { label: 'アノテートのバージョン管理...', icon: 'history', action: openAnnotationVersions },
        ] : []),
      ] : []),
      ...(window.MeldexStandaloneDefaultApps?.isAvailable?.() ? [
        sep(),
        { label: '既定アプリに設定...', icon: 'settings', action: () => window.MeldexStandaloneDefaultApps.openDialog({ source: 'menu' }) },
      ] : []),
    ];
  }

  async function openMenuAt(clientX, clientY) {
    if (window.MeldexStandaloneNative && !window.MeldexViewerAnnotations && window.MeldexViewerTextLayer?.getSelection()) {
      try {
        await window.MeldexViewerHighlights.ensureNative();
      } catch(error) { window.showStatus?.('ハイライトを読み込めませんでした: '+error.message,true); return; }
    }
    window.MeldexContextMenuUI?.openAt({ x: clientX, y: clientY, ariaLabel: 'ビューワーメニュー', items: items() });
  }

  // ツールバー左端のアプリアイコン＝メインメニューボタン（UI共通ルール19）。右クリックと同じメニューを
  // ボタンの直下に開き、閉じたらボタンへフォーカスを戻す。開いている間にもう一度押すと閉じる。
  const mainMenuButton = document.getElementById('btn-viewer-main-menu');
  if (mainMenuButton) {
    let closedByButtonPress = false;
    // 共通メニューはdocumentのcaptureで外側クリックを閉じる。その前に
    // 押す直前の状態を記録し、閉じた直後にclickで再び開くことを防ぐ。
    window.addEventListener('pointerdown', event => {
      closedByButtonPress = mainMenuButton.contains(event.target)
        && !!window.MeldexContextMenuUI?.isOpen?.() && mainMenuButton.getAttribute('aria-expanded') === 'true';
    }, true);
    mainMenuButton.addEventListener('click', event => {
      event.stopPropagation();
      const closePressed = (event.detail > 0 && closedByButtonPress)
        || (!!window.MeldexContextMenuUI?.isOpen?.() && mainMenuButton.getAttribute('aria-expanded') === 'true');
      closedByButtonPress = false;
      if (closePressed) { window.MeldexContextMenuUI?.close?.(); return; }
      if (!window.MeldexContextMenuUI?.openAt) return;
      mainMenuButton.setAttribute('aria-expanded', 'true');
      window.MeldexContextMenuUI.openAt({
        anchorRect: mainMenuButton.getBoundingClientRect(), ariaLabel: 'ビューワーメニュー', items: items(),
        restoreFocus: mainMenuButton,
        onClose: () => mainMenuButton.setAttribute('aria-expanded', 'false'),
      });
    });
  }

  const display = document.getElementById('display');
  let secondaryPointer = null;
  let suppressDraggedContext = false;
  display.addEventListener('pointerdown', event => {
    if (event.button !== 2) return;
    secondaryPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    suppressDraggedContext = false;
  });
  display.addEventListener('pointermove', event => {
    if (!secondaryPointer || secondaryPointer.id !== event.pointerId) return;
    const dx = event.clientX - secondaryPointer.x;
    const dy = event.clientY - secondaryPointer.y;
    if (dx * dx + dy * dy > 100) suppressDraggedContext = true;
  });
  ['pointerup', 'pointercancel'].forEach(name => display.addEventListener(name, event => {
    if (secondaryPointer?.id === event.pointerId) secondaryPointer = null;
  }));
  display.addEventListener('contextmenu', event => {
    // 静止した右クリックだけを開き、10px超のドラッグ終了では表示しない。
    if (suppressDraggedContext || window.MeldexViewerScene?.isPointerPanning?.()) {
      suppressDraggedContext = false;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    openMenuAt(event.clientX, event.clientY);
  });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(display, event => openMenuAt(event.clientX, event.clientY), { moveThreshold: 10 });
  }
})();
