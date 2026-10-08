/* viewer-annotation-toolbar.js — ビューワーのアノテート用フロートパネル。

   Meldex本体の #ann-toolbar（Meldex.html）と同じ部品構成・同じ共通クラス
   （.floating-toolbar / .ft-drag / .ann-tool / .ann-width-control / .gb-color-swatch）で
   組み立てる。色は本体と同じ共通カラーパレット（gb-color-palette.js の openColorPalette）を開く。
   以前の単独ビューワーは meldex-core.js の createMarkupToolbar()（固定8色のミニパレット・
   太さ/不透明度なし）を使っていたため、本体と見た目も操作も揃っていなかった。

   描画エンジンだけはビューワー固有の window.MeldexViewerAnnotationScene を使う
   （本体の gb-annotations.js は画面座標系が違うため持ち込まない）。本体にしか意味のない
   ボタン（アノテートパネル・スクリーンショット・表示ロック）は置かない。

   公開: window.MeldexViewerAnnotationToolbar */
(function () {
  'use strict';

  const WIDTH_TOOLS = [
    { tool: 'pen', label: 'ペンの太さ', min: 1, max: 16, value: 3 },
    { tool: 'marker', label: 'マーカーの太さ', min: 4, max: 40, value: 12 },
    { tool: 'eraser', label: '消しゴムの太さ', min: 4, max: 48, value: 14 },
  ];
  const TOOLS = [
    { name: 'pen', icon: 'pencil', title: 'ペン' },
    { name: 'marker', icon: 'highlighter', title: 'マーカー' },
    { name: 'lasso', icon: 'lasso', title: '投げ縄塗り' },
    { name: 'rect', icon: 'square', title: '矩形塗り' },
    { name: 'eraser', icon: 'eraser', title: '消しゴム' },
    { name: 'sticky', icon: 'stickyNote', title: '付箋' },
  ];
  const POSITION_KEY = 'meldex-viewer-annotation-toolbar-position-v1';

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 16) : '';
  }

  function separator() {
    const element = document.createElement('div');
    element.className = 'viewer-ann-toolbar-separator';
    return element;
  }

  function widthControl(entry, controller) {
    const label = document.createElement('label');
    label.className = 'ann-width-control';
    label.title = entry.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `ann-width-${entry.tool}`;
    input.dataset.annWidthTool = entry.tool;
    input.min = String(entry.min);
    input.max = String(entry.max);
    input.step = '1';
    input.value = String(entry.value);
    input.setAttribute('aria-label', entry.label);
    const value = document.createElement('span');
    value.id = `ann-width-${entry.tool}-label`;
    value.textContent = String(entry.value);
    input.addEventListener('input', () => {
      value.textContent = input.value;
      controller.setWidth(entry.tool, Number(input.value));
    });
    label.append(input, value);
    return label;
  }

  // 置ける範囲。右サイドバーを開くと本文が左へ押し出されるので、その分を除く
  // （body の padding-right = --sa-secondary-inset）。#display 自体は回転・反転の
  // transform が掛かるため、位置の基準には使わない。
  function placementArea() {
    const root = document.documentElement;
    const inset = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
    return { width: Math.max(200, root.clientWidth - inset), height: root.clientHeight };
  }

  function clampPosition(x, y, width, height) {
    const area = placementArea();
    return {
      x: Math.max(4, Math.min(area.width - width - 4, x)),
      y: Math.max(4, Math.min(area.height - height - 4, y)),
    };
  }

  // 呼び出しボタン（下端ツールバーのアノテート）の真上へ置く。本体はツールバーが上端に
  // あるためボタンの左横へ出すが、ビューワーのボタンは下端にあるので、そのまま横へ出すと
  // 下端ツールバーへ重なる。入らない時だけボタンの下へ逃がす。
  function positionNextToButton(toolbar, anchor) {
    toolbar.classList.add('visible');
    const toolbarRect = toolbar.getBoundingClientRect();
    const width = toolbarRect.width;
    const height = toolbarRect.height;
    const area = placementArea();
    const anchorRect = anchor ? anchor.getBoundingClientRect() : null;
    const baseX = anchorRect ? anchorRect.right - width : area.width - width - 8;
    let y = (anchorRect ? anchorRect.top : area.height) - height - 8;
    if (y < 4) y = anchorRect ? anchorRect.bottom + 8 : 4;
    const position = clampPosition(baseX, y, width, height);
    toolbar.style.left = position.x + 'px';
    toolbar.style.top = position.y + 'px';
  }

  function clampIntoViewport(toolbar) {
    const rect = toolbar.getBoundingClientRect();
    const position = clampPosition(rect.left, rect.top, rect.width, rect.height);
    toolbar.style.left = position.x + 'px';
    toolbar.style.top = position.y + 'px';
  }

  function savePosition(toolbar) {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify({
        left: parseFloat(toolbar.style.left) || 0,
        top: parseFloat(toolbar.style.top) || 0,
      }));
    } catch { /* 保存できない環境では画面を閉じるまでの位置だけ維持する。 */ }
  }

  function restorePosition(toolbar) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null'); } catch { saved = null; }
    if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return false;
    toolbar.style.left = saved.left + 'px';
    toolbar.style.top = saved.top + 'px';
    return true;
  }

  function setupDrag(toolbar) {
    const handle = toolbar.querySelector('.ft-drag');
    if (!handle) return;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    const onMove = (event) => {
      event.preventDefault();
      const rect = toolbar.getBoundingClientRect();
      const position = clampPosition(originX + event.clientX - startX, originY + event.clientY - startY, rect.width, rect.height);
      toolbar.style.left = position.x + 'px';
      toolbar.style.top = position.y + 'px';
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      savePosition(toolbar);
    };
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const rect = toolbar.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      originX = rect.left;
      originY = rect.top;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  function build(controller) {
    const toolbar = document.createElement('div');
    toolbar.id = 'ann-toolbar';
    toolbar.className = 'floating-toolbar viewer-ann-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'アノテートツール');
    toolbar.dataset.e2eId = 'viewer-annotation-toolbar';

    const drag = document.createElement('div');
    drag.className = 'ft-drag';
    drag.title = 'ドラッグで移動';
    drag.innerHTML = icon('gripVertical', 14);
    toolbar.appendChild(drag);

    const widthByTool = new Map(WIDTH_TOOLS.map(entry => [entry.tool, entry]));
    TOOLS.forEach((entry, index) => {
      if (entry.name === 'sticky') toolbar.appendChild(separator());
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ann-tool' + (index === 0 ? ' active' : '');
      button.dataset.tool = entry.name;
      button.title = entry.title;
      button.setAttribute('aria-label', entry.title);
      button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
      button.innerHTML = icon(entry.icon, 16);
      button.addEventListener('click', () => controller.setTool(entry.name));
      toolbar.appendChild(button);
      const width = widthByTool.get(entry.name);
      if (width) toolbar.appendChild(widthControl(width, controller));
    });

    toolbar.appendChild(separator());
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.id = 'ann-color-swatch';
    swatch.className = 'gb-color-swatch gb-color-swatch--field';
    swatch.title = '色';
    swatch.setAttribute('aria-label', '色');
    swatch.setAttribute('aria-haspopup', 'dialog');
    swatch.addEventListener('click', () => controller.openColorPicker(swatch));
    toolbar.appendChild(swatch);

    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.id = 'ann-opacity';
    opacity.min = '0';
    opacity.max = '1';
    opacity.step = '0.05';
    opacity.value = '1';
    opacity.title = '全体の不透明度';
    opacity.setAttribute('aria-label', '全体の不透明度');
    const opacityLabel = document.createElement('span');
    opacityLabel.id = 'ann-opacity-label';
    opacityLabel.textContent = '100%';
    opacity.addEventListener('input', () => {
      opacityLabel.textContent = Math.round(Number(opacity.value) * 100) + '%';
      controller.setOpacity(Number(opacity.value));
    });
    toolbar.append(opacity, opacityLabel);

    toolbar.appendChild(separator());
    const overlayToggle = document.createElement('button');
    overlayToggle.type = 'button';
    overlayToggle.id = 'btn-overlay-toggle';
    overlayToggle.className = 'ann-tool active';
    overlayToggle.title = 'オーバーレイ表示中';
    overlayToggle.setAttribute('aria-label', 'オーバーレイ表示');
    overlayToggle.innerHTML = icon('eye', 16);
    overlayToggle.addEventListener('click', () => controller.toggleVisible());
    toolbar.appendChild(overlayToggle);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ann-tool viewer-ann-danger';
    clear.title = '全削除';
    clear.setAttribute('aria-label', '全削除');
    clear.innerHTML = icon('trash2', 16);
    clear.addEventListener('click', () => controller.clearAll());
    toolbar.appendChild(clear);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ann-tool viewer-ann-toolbar-close';
    close.title = '閉じる';
    close.setAttribute('aria-label', '閉じる');
    close.innerHTML = icon('x', 14);
    close.addEventListener('click', () => controller.close());
    toolbar.appendChild(close);

    document.body.appendChild(toolbar);
    setupDrag(toolbar);
    return toolbar;
  }

  function create(controller) {
    const toolbar = build(controller);
    let positioned = restorePosition(toolbar);

    function syncFromState(state) {
      toolbar.querySelectorAll('.ann-tool[data-tool]').forEach(button => {
        const active = button.dataset.tool === state.tool;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      const swatch = toolbar.querySelector('#ann-color-swatch');
      if (swatch) {
        swatch.style.background = state.color || '';
        swatch.dataset.color = state.color || '';
      }
      const opacity = toolbar.querySelector('#ann-opacity');
      const opacityLabel = toolbar.querySelector('#ann-opacity-label');
      if (opacity && document.activeElement !== opacity) {
        opacity.value = String(state.opacity == null ? 1 : state.opacity);
        if (opacityLabel) opacityLabel.textContent = Math.round(Number(opacity.value) * 100) + '%';
      }
      WIDTH_TOOLS.forEach(entry => {
        const input = toolbar.querySelector(`#ann-width-${entry.tool}`);
        const label = toolbar.querySelector(`#ann-width-${entry.tool}-label`);
        const width = Number(state.widths?.[entry.tool]);
        if (!input || document.activeElement === input || !Number.isFinite(width) || width <= 0) return;
        input.value = String(width);
        if (label) label.textContent = String(width);
      });
      const overlayToggle = toolbar.querySelector('#btn-overlay-toggle');
      if (overlayToggle) {
        const visible = state.visible !== false;
        overlayToggle.classList.toggle('active', visible);
        overlayToggle.title = visible ? 'オーバーレイ表示中' : 'オーバーレイ非表示';
        overlayToggle.setAttribute('aria-label', overlayToggle.title);
        overlayToggle.innerHTML = icon(visible ? 'eye' : 'eyeOff', 16);
      }
    }

    function setVisible(visible, anchor) {
      if (!visible) {
        toolbar.classList.remove('visible');
        return;
      }
      if (!positioned) {
        positionNextToButton(toolbar, anchor);
        positioned = true;
      }
      toolbar.classList.add('visible');
      clampIntoViewport(toolbar);
    }

    // 初期の太さをエンジンへ渡しておく（スライダーを一度も触っていない状態でも本体と同じ太さで描く）。
    WIDTH_TOOLS.forEach(entry => controller.setWidth(entry.tool, entry.value));

    const reclamp = () => { if (toolbar.classList.contains('visible')) clampIntoViewport(toolbar); };
    window.addEventListener('resize', reclamp);
    // 右サイドバーの開閉・幅変更でも表示領域が変わる（viewer-resize.js が知らせる）。
    window.addEventListener('viewer-layout-resize', reclamp);

    return { element: toolbar, setVisible, syncFromState };
  }

  window.MeldexViewerAnnotationToolbar = { create };
})();
