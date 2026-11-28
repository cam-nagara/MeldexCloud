/* viewer-context-menu.js — 共通MeldexContextMenuUIを使うビューワー右クリック/長押しメニュー。 */
(function () {
  'use strict';

  const Scene = () => window.MeldexViewerScene;
  const Annotations = () => window.MeldexViewerAnnotations;
  const sep = () => ({ type: 'separator' });
  const annotationsAvailable = () => document.documentElement.dataset.viewerAnnotationCapability !== 'disabled';
  // アノテートのバージョン管理は単独ウィンドウのビューワーだけで開く（本体のパネル内では
  // 本体のアノテートパネルにバージョン管理がある）。以前はツールバーのボタンだった。
  const annotationVersionsAvailable = () => window.parent === window
    && annotationsAvailable() && (window.MeldexStandaloneNative
      || typeof window.MeldexStandaloneVersionHistory?.openViewerAnnotations === 'function');

  function openAnnotationVersions() {
    Promise.resolve()
      .then(() => window.MeldexViewerAnnotationEntry.ensureReady())
      .then(() => window.MeldexStandaloneVersionHistory.openViewerAnnotations())
      .catch(error => Scene()?.flashStatus?.('アノテートのバージョンを開けませんでした: ' + String(error?.message || error), 5000));
  }

  function publicImageUrl(raw) {
    try {
      const url = new URL(String(raw || ''), location.href), host = url.hostname.toLowerCase().replace(/\.+$/, '');
      if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin || url.username || url.password) return '';
      if (!host.includes('.') || /\.(?:localhost|local|lan|home|internal|localdomain)$/.test(host)
        || host.includes(':') || /^(?:0|10|127)\./.test(host) || /^169\.254\./.test(host)
        || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
        || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
        || /^198\.(?:18|19)\./.test(host) || /^(?:22[4-9]|2[3-5]\d)\./.test(host)) return '';
      return url.href;
    } catch { return ''; }
  }

  // EPUBの本文は枠（iframe）の中で選ぶ（viewer-epub.js）。
  const epub = () => (window.MeldexViewerEpub?.isActive?.() ? window.MeldexViewerEpub : null);
  function selectedText() {
    if (epub()) return epub().selectedText();
    return String(window.MeldexViewerTextLayer?.getSelection?.()?.text || window.getSelection?.()?.toString?.() || '').trim();
  }

  // 右クリックした位置が選んだ文字の上（または、すぐ近く）か。
  function pointOnSelection(x, y) {
    if (epub()) return epub().pointOnSelection(x, y);
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const margin = 8;
    for (let index = 0; index < selection.rangeCount; index++) {
      for (const rect of selection.getRangeAt(index).getClientRects()) {
        if (x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin) return true;
      }
    }
    return false;
  }

  function copySelectedText(text) {
    // 文字の層の copy の処理が、選んだ文字を正しい順で渡す（viewer-text-layer.js）。
    let copied = false;
    if (epub()) copied = epub().copySelection();
    else try { copied = document.execCommand('copy'); } catch { copied = false; }
    if (copied) { Scene()?.flashStatus?.('コピーしました', 1200); return; }
    Promise.resolve(navigator.clipboard?.writeText?.(text))
      .then(() => Scene()?.flashStatus?.('コピーしました', 1200))
      .catch(() => Scene()?.flashStatus?.('コピーできませんでした。Ctrl+C でもう一度お試しください', 5000));
  }

  // 文字を選んでいる時の右クリックは、選んだ文字への操作だけを出す（2026-11-27 利用者の依頼）。
  // ページ送り・拡大縮小・再生などの閲覧操作は、選択を外して右クリックするか、メインメニューから使う。
  function selectionItems(text) {
    return [
      { label: 'コピー', icon: 'copy', shortcut: 'Ctrl+C', action: () => copySelectedText(text) },
      ...(annotationsAvailable() ? (window.MeldexViewerHighlights?.menuItems() || []) : []),
      sep(),
      ...searchItems(null, { textOnly: true }),
      ...(typeof window.MeldexViewerOcr?.search === 'function'
        ? [{ label: '文書内を検索…', icon: 'fileSearch', action: () => window.MeldexViewerOcr.search() }] : []),
    ];
  }

  function searchItems(target, options = {}) {
    const text = selectedText();
    const image = options.textOnly ? null : (target?.closest?.('img') || (!target && document.querySelector?.('.layer.show img')));
    // 端末内の画像をアップロードせず、ローカルAPIのURL・ファイルの場所も外へ渡さない。
    const imageUrl = image && (publicImageUrl(image._viewerItem?.path || image._viewerItem?.url)
      || publicImageUrl(image.currentSrc || image.src));
    const open = url => {
      try {
        const opened = window.open(url, '_blank', 'noopener');
        if (opened) {
          opened.opener = null;
          Scene()?.flashStatus?.('検索ページを開きました', 1500);
          return;
        }
      } catch { /* 開く操作が拒否された時も閲覧と選択を保持する。 */ }
      Scene()?.flashStatus?.('検索ページを開けませんでした。ブラウザーの設定を確認して、もう一度お試しください', 5000);
    };
    return [
      ...(text ? [{ label: 'Googleで検索', icon: 'search', action: () => open('https://www.google.com/search?q=' + encodeURIComponent(text)) }] : []),
      ...(image ? [{ label: 'Googleで画像検索', icon: 'scanSearch', action: () => open(imageUrl
        ? 'https://www.google.com/searchbyimage?image_url=' + encodeURIComponent(imageUrl)
        : 'https://images.google.com/') }] : []),
    ];
  }

  // 進む方向ごとの項目名とアイコン（上へ・下へ・左へ・右へ）。
  const DIRECTION_ITEMS = [
    { value: 'up', label: '上へ', icon: 'arrowUp' },
    { value: 'down', label: '下へ', icon: 'arrowDown' },
    { value: 'left', label: '左へ', icon: 'arrowLeft' },
    { value: 'right', label: '右へ', icon: 'arrowRight' },
  ];

  function items(target) {
    const scene = Scene();
    const playbackActive = scene.isPlaybackActive?.() ?? scene.isPlaying();
    // 前へ・次へ・1枚ずらしのアイコンは進む方向に合わせる（ショートカット表記はレジストリの現在値）。
    const icons = window.MeldexViewerControls?.directionIcons?.()
      || { prev: 'chevronLeft', next: 'chevronRight', shiftBackward: 'arrowLeft', shiftForward: 'arrowRight' };
    const direction = scene.getDirection?.() || 'right';
    return [
      ...searchItems(target),
      ...(window.MeldexViewerScreenshotSource?.menuItems?.() || []),
      ...(window.MeldexViewerOcr?.menuItems?.() || []),
      { label: '前へ', icon: icons.prev, shortcutId: 'viewer.prev', action: () => { scene.pause(); scene.prevGroup(); } },
      { label: '次へ', icon: icons.next, shortcutId: 'viewer.next', action: () => { scene.pause(); scene.nextGroup(); } },
      { label: '1枚戻る', icon: icons.shiftBackward, shortcutId: 'viewer.shiftBackward', action: () => { scene.pause(); scene.shiftBackward(); } },
      { label: '1枚進む', icon: icons.shiftForward, shortcutId: 'viewer.shiftForward', action: () => { scene.pause(); scene.shiftForward(); } },
      sep(),
      { label: scene.isSheetContext() ? '前の画像行' : '前のフォルダ', icon: 'folderInput', shortcutId: 'viewer.prevFolder', action: () => scene.prevFolder() },
      { label: scene.isSheetContext() ? '次の画像行' : '次のフォルダ', icon: 'folderOutput', shortcutId: 'viewer.nextFolder', action: () => scene.nextFolder() },
      sep(),
      { label: playbackActive ? '一時停止' : '再生', icon: playbackActive ? 'pause' : 'play', shortcutId: 'viewer.playPause', action: () => scene.togglePlay() },
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
        { label: `${scene.getMode() === 'single' ? '● ' : ''}単ページ`, icon: 'rectangleHorizontal', action: () => scene.setMode('single') },
        { label: `${scene.getMode() === 'spread' ? '● ' : ''}見開き`, icon: 'bookOpen', action: () => scene.setMode('spread') },
      ] },
      { label: '進む方向', icon: 'move', items: DIRECTION_ITEMS.map(entry => (
        { label: `${direction === entry.value ? '● ' : ''}${entry.label}`, icon: entry.icon, ariaLabel: entry.label, action: () => scene.setDirection(entry.value) }
      )) },
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
        { label: 'アノテート', icon: 'squarePen', shortcutId: 'viewer.annotation', action: () => window.MeldexViewerAnnotationEntry.toggle() },
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

  async function openMenuAt(clientX, clientY, target) {
    if (window.MeldexStandaloneNative && !window.MeldexViewerAnnotations && (window.MeldexViewerTextLayer?.getSelection() || epub()?.selectedText())) {
      try {
        await window.MeldexViewerHighlights.ensureNative();
      } catch(error) { window.showStatus?.('ハイライトを読み込めませんでした: '+error.message,true); return; }
    }
    const text = selectedText();
    let menuItems = text && pointOnSelection(clientX, clientY) ? selectionItems(text) : items(target);
    // 描いた線・塗りの上なら、先頭に「色...」（共通カラーパレットで色と不透明度を変える）
    const hit = annotationsAvailable() && !(text && pointOnSelection(clientX, clientY))
      ? window.MeldexViewerAnnotationScene?.hitAt?.(clientX, clientY) : null;
    if (hit) {
      menuItems = [{ label: '色...', ariaLabel: '色...', icon: 'palette', e2eId: 'viewer-annotation-recolor',
        action: () => void window.MeldexViewerAnnotationScene.recolor(hit, clientX, clientY) }, sep(), ...menuItems];
    }
    window.MeldexContextMenuUI?.openAt({ x: clientX, y: clientY, ariaLabel: 'ビューワーメニュー', items: menuItems });
  }
  // EPUBの本文（iframe）の右クリックから開く入口（viewer-epub.js が親の座標へ直して呼ぶ）
  window.MeldexViewerContextMenu = Object.freeze({ openAt: openMenuAt });

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
    openMenuAt(event.clientX, event.clientY, event.target);
  });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(display, event => openMenuAt(event.clientX, event.clientY, event.target), { moveThreshold: 10 });
  }
})();
