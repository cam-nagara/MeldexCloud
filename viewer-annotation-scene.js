/* viewer-annotation-scene.js — Meldexビューワー: 注釈の画像固有ピクセル座標シーン。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 3. 注釈の画像追従」
   方針:
     - 表示中の画像・PDFページ1枚ごとに「メディア(img/canvas) + 注釈SVG」を1つの<div>で束ねる
       （見開き/マンガでは2シーンが同時に独立して存在する）。
     - 注釈SVGは viewBox="0 0 mediaWidth mediaHeight" を画像の固有ピクセル座標系として使う。
       SVGを画像と同じ祖先（#layer→#display）の中に、画像の実描画サイズへ position:relative の
       ラッパーで一致させて置くことで、フィット倍率×ズーム×パン×回転×反転は
       既存のCSS transform連鎖（#displayのscale/rotate、#layerのtranslate、img/canvasの
       実寸style.width/height）にそのまま追従する。JS側で個別に再計算しない。
     - 画面座標→画像固有座標の逆変換は SVGElement.getScreenCTM().inverse() を使う
       （ブラウザが実際の合成後行列を返すため、回転90/180/270度・反転を含めて正確）。
     - 新規に作成する線・付箋は必ず coordinateSpace: "media-pixel-v1" を付けて保存する。
       coordinateSpace を持たない既存注釈（旧仕様）は破壊的変換をせず、
       viewer-annotation-legacy.js の「表示領域全体基準」オーバーレイでそのまま表示する
       （このファイルの責務外）。
   公開: window.MeldexViewerAnnotationScene */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const COORD_SPACE = 'media-pixel-v1';

  function Scene() { return window.MeldexViewerScene; }

  // ============================================================
  // 座標変換ヘルパー（getScreenCTM ベース。回転/反転/ズーム/パンを個別計算しない）
  // ============================================================

  // 画面座標(clientX/clientY) → シーンSVGのローカル座標(viewBox空間 = 画像固有ピクセル座標)
  function clientToLocal(svg, clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  // シーンSVGのローカル座標(viewBox空間) → 画面座標(clientX/clientY)
  function localToClient(svg, x, y) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(x, y).matrixTransform(ctm);
    return { x: pt.x, y: pt.y };
  }

  // 画面上のNピクセルに相当するローカル(画像固有ピクセル)距離。ヒット許容量・ハンドルサイズ計算用。
  function localLengthForScreenPx(svg, px) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return px;
    const scale = Math.hypot(ctm.a, ctm.b) || 1;
    return px / scale;
  }

  // ============================================================
  // シーン管理
  // ============================================================

  let _scenes = [];
  let _rebuildToken = 0;
  let _ann = {
    active: false, visible: true, tool: 'pen', color: (window.PALETTE_COLORS && window.PALETTE_COLORS[7]) || '#c48080',
    opacity: 1, drawing: false, widths: {},
  };

  function ann() { return _ann; }

  function annotationCursor(tool = _ann.tool) {
    if (tool === 'sticky') return 'cell';
    const lineTools = new Set(['polyline', 'ellipse-line', 'rect-line']);
    if (!['pen', 'marker', 'eraser'].includes(tool) && !lineTools.has(tool)) return 'crosshair';
    const widthKey = lineTools.has(tool) ? 'pen' : tool;
    const width = Math.max(4, Math.min(48, Number(_ann.widths?.[widthKey]) || 3));
    const size = Math.ceil(width + 6);
    const shape = tool === 'marker'
      ? `<rect x="3" y="3" width="${width}" height="${width}" fill="rgba(255,255,255,.18)" stroke="white"/><rect x="2" y="2" width="${width + 2}" height="${width + 2}" fill="none" stroke="black"/>`
      : `<circle cx="${size / 2}" cy="${size / 2}" r="${width / 2}" fill="rgba(255,255,255,.12)" stroke="white"/><circle cx="${size / 2}" cy="${size / 2}" r="${width / 2 + 1}" fill="none" stroke="black"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${shape}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.floor(size / 2)} ${Math.floor(size / 2)}, crosshair`;
  }

  function getScenes() { return _scenes.slice(); }

  function findSceneByPath(path) {
    return _scenes.find(s => s.path === path) || null;
  }

  function findSceneForClientPoint(clientX, clientY) {
    for (const scene of _scenes) {
      const r = scene.wrap.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return scene;
    }
    return null;
  }

  function _wrapMediaElement(mediaEl) {
    const existing = mediaEl.parentElement;
    if (existing && existing.classList.contains('viewer-ann-scene-wrap')) return existing;
    const wrap = document.createElement('div');
    wrap.className = 'viewer-ann-scene-wrap';
    existing.insertBefore(wrap, mediaEl);
    wrap.appendChild(mediaEl);
    return wrap;
  }

  function _naturalMediaSize(mediaEl, item, isPdf) {
    if (isPdf) {
      const w = Number(item?.w) || mediaEl.width || 1;
      const h = Number(item?.h) || mediaEl.height || 1;
      return { w, h };
    }
    const w = mediaEl.naturalWidth || Number(item?.w) || mediaEl.width || 1;
    const h = mediaEl.naturalHeight || Number(item?.h) || mediaEl.height || 1;
    return { w, h };
  }

  function _buildSceneSvg(mediaWidth, mediaHeight) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${mediaWidth} ${mediaHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('viewer-ann-scene-svg');
    svg.style.display = _ann.visible === false ? 'none' : '';
    svg.style.pointerEvents = _ann.active ? 'auto' : 'none';
    svg.style.cursor = _ann.active ? annotationCursor() : '';
    const strokesG = document.createElementNS(NS, 'g');
    strokesG.classList.add('viewer-ann-strokes');
    svg.appendChild(strokesG);
    const notesG = document.createElementNS(NS, 'g');
    notesG.classList.add('viewer-ann-notes');
    svg.appendChild(notesG);
    return { svg, strokesG, notesG };
  }

  // 表示中グループ(1枚 or 見開き2枚)へ、シーンを1件ずつ再構築する。
  // viewer-scene.js の showGroup() → swapLayers() 完了後（画像ロード後・レイヤー入替後）に
  // window.MeldexViewerAnnotations.onSceneChanged() から呼ばれるほか、注釈モードON時の
  // 再読み込み（同じimg/canvas要素のまま）でも呼ばれる。後者では既存のwrap/svgを再利用し、
  // 描画内容だけをクリアして再構築する（DOM要素の作り直しによるSVG二重化を避ける）。
  async function rebuild() {
    const scene = Scene();
    if (!scene) return [];
    const token = ++_rebuildToken;
    const order = scene.currentDisplayOrder();
    const items = scene.getItems();
    const isPdf = scene.isPdf();
    const activeLayerId = scene.getActiveLayerId();
    const layerEl = document.getElementById('layer' + activeLayerId);
    const mediaEls = layerEl ? Array.from(layerEl.querySelectorAll('img, canvas')) : [];
    const prevByEl = new Map(_scenes.map(s => [s.mediaEl, s]));

    const nextScenes = [];
    for (let i = 0; i < mediaEls.length && i < order.length; i++) {
      const mediaEl = mediaEls[i];
      const item = items[order[i]];
      if (!item) continue;
      const path = scene.itemAnnotationPath(item);
      if (!path) continue;
      const reuse = prevByEl.get(mediaEl);
      let entry;
      if (reuse && reuse.mediaEl.isConnected) {
        entry = reuse;
        entry.path = path;
        entry.strokesG.replaceChildren();
        entry.notesG.replaceChildren();
        (entry.notes || []).forEach(n => n.resizeObserver?.disconnect());
        entry.notes = [];
      } else {
        const { w, h } = _naturalMediaSize(mediaEl, item, isPdf);
        const wrap = _wrapMediaElement(mediaEl);
        const built = _buildSceneSvg(w, h);
        wrap.appendChild(built.svg);
        entry = {
          path,
          mediaEl,
          wrap,
          svg: built.svg,
          strokesG: built.strokesG,
          notesG: built.notesG,
          mediaWidth: w,
          mediaHeight: h,
          pageIndex: isPdf ? (Number(item.pageNum) || 1) - 1 : undefined,
          isPdf,
          notes: [],
        };
      }
      nextScenes.push(entry);
    }
    // 表示グループから外れた旧シーンのSVG・付箋を除去する
    _scenes.forEach(s => {
      if (nextScenes.includes(s)) return;
      (s.notes || []).forEach(n => n.resizeObserver?.disconnect());
      if (s.svg?.isConnected) s.svg.remove();
    });
    if (token !== _rebuildToken) return _scenes;
    _scenes = nextScenes;
    _draw.reset();
    window.MeldexViewerAnnotationLegacy?.rebuild?.(_scenes.map(s => s.path));
    await Promise.all(_scenes.map(s => _loadScene(s, token)));
    if (token !== _rebuildToken) return _scenes;
    return _scenes;
  }

  // ============================================================
  // ストローク描画（pen/marker/lasso/rect）＋消しゴム
  // ============================================================

  function _pathD(pts) {
    if (pts.length < 2) return '';
    let d = 'M ' + pts[0][0] + ' ' + pts[0][1];
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i][0] + pts[i + 1][0]) / 2;
      const midY = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q ${pts[i][0]} ${pts[i][1]} ${midX} ${midY}`;
    }
    const last = pts[pts.length - 1];
    return d + ` L ${last[0]} ${last[1]}`;
  }
  function _rectData(pts) {
    const a = pts?.[0] || [0, 0], b = pts?.[pts.length - 1] || a;
    const x1 = Number(a[0]) || 0, y1 = Number(a[1]) || 0, x2 = Number(b[0]) || 0, y2 = Number(b[1]) || 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  function _ellipseData(pts) {
    const rect = _rectData(pts);
    return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, rx: rect.width / 2, ry: rect.height / 2 };
  }
  function _drawWidth(tool, widthOverride, fallback) {
    const w = Number(widthOverride);
    if (Number.isFinite(w) && w > 0) return w;
    return fallback;
  }
  function _normalizeOpacity(value, fallback = 1) {
    if (typeof window._normalizeCoreAnnotationOpacity === 'function') return window._normalizeCoreAnnotationOpacity(value, fallback);
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  }

  function _applyRectEl(el, data, color, opacity, preview) {
    const o = _normalizeOpacity(opacity, 1);
    el.setAttribute('x', Number(data?.x) || 0);
    el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(0.01, Number(data?.width) || 0));
    el.setAttribute('height', Math.max(0.01, Number(data?.height) || 0));
    el.setAttribute('fill', color);
    el.setAttribute('fill-opacity', String(o * (preview ? 0.2 : 0.4)));
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', '1');
    el.setAttribute('stroke-opacity', String(o));
    if (preview) el.setAttribute('stroke-dasharray', '4,4'); else el.removeAttribute('stroke-dasharray');
    return el;
  }

  function renderStroke(scene, type, points, color, opacity, annId, widthMedia) {
    const o = _normalizeOpacity(opacity, 1);
    let el;
    if (type === 'lasso') {
      el = document.createElementNS(NS, 'polygon');
      el.setAttribute('points', points.map(p => p[0] + ',' + p[1]).join(' '));
      el.setAttribute('fill', color); el.setAttribute('fill-opacity', String(o * 0.4));
      el.setAttribute('stroke', color); el.setAttribute('stroke-width', String(_drawWidth(type, widthMedia, 1)));
    } else {
      el = document.createElementNS(NS, 'path');
      el.setAttribute('d', _pathD(points));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(_drawWidth(type, widthMedia, type === 'marker' ? 12 : 3)));
      el.setAttribute('stroke-opacity', type === 'marker' ? String(o * 0.5) : String(o));
      el.setAttribute('stroke-linecap', type === 'marker' ? 'butt' : 'round'); el.setAttribute('stroke-linejoin', 'round');
    }
    // pointer-eventsは個別指定しない（setState()が切り替える親svgの値をそのまま継承させる。
    // 徹底チェック2026-08-02: 個別にautoを指定すると、注釈OFF(svg側none)時でも子要素の
    // 明示autoが親のnoneを上書きし、下にあるページ送り領域(#nav-prev-area等)やパン操作の
    // クリックを奪ってしまう。消しゴムのヒット判定は_coreAnnotationElementHitの座標計算
    // ベースでDOMのpointer-eventsに依存しないため、個別autoは不要）。
    if (annId) el.dataset.annId = annId;
    scene.strokesG.appendChild(el);
    return el;
  }

  function renderRect(scene, data, color, opacity, annId) {
    const el = _applyRectEl(document.createElementNS(NS, 'rect'), data, color, opacity, false);
    // renderStroke同様、pointer-eventsは親svgからの継承に一本化する（個別指定禁止）。
    if (annId) el.dataset.annId = annId;
    scene.strokesG.appendChild(el);
    return el;
  }

  function renderShape(scene, type, data, color, opacity, annId, preview) {
    if (type === 'rect') return renderRect(scene, data, color, opacity, annId);
    const ellipse = type.startsWith('ellipse');
    const el = document.createElementNS(NS, ellipse ? 'ellipse' : 'rect');
    const outlined = type === 'ellipse-line' || type === 'rect-line';
    if (ellipse) {
      el.setAttribute('cx', Number(data?.cx) || 0); el.setAttribute('cy', Number(data?.cy) || 0);
      el.setAttribute('rx', Math.max(.01, Number(data?.rx) || 0)); el.setAttribute('ry', Math.max(.01, Number(data?.ry) || 0));
    } else {
      el.setAttribute('x', Number(data?.x) || 0); el.setAttribute('y', Number(data?.y) || 0);
      el.setAttribute('width', Math.max(.01, Number(data?.width) || 0)); el.setAttribute('height', Math.max(.01, Number(data?.height) || 0));
    }
    const o = _normalizeOpacity(opacity, 1);
    el.setAttribute('fill', outlined ? 'none' : color);
    el.setAttribute('fill-opacity', outlined ? '0' : String(o * (preview ? .2 : .4)));
    el.setAttribute('stroke', color); el.setAttribute('stroke-opacity', String(o));
    el.setAttribute('stroke-width', String(_drawWidth(type, data?.lineWidth, 1)));
    if (preview) el.setAttribute('stroke-dasharray', '4,4');
    if (annId) el.dataset.annId = annId;
    scene.strokesG.appendChild(el);
    return el;
  }

  const _draw = (() => {
    let active = null; // { scene, tool, path, pressures, previewEl, widthMedia }
    function reset() {
      active?.previewEl?.remove();
      active = null;
      _ann.drawing = false;
    }
    function begin(scene, clientX, clientY) {
      const local = clientToLocal(scene.svg, clientX, clientY);
      const baseWidthScreen = _ann.tool === 'marker' ? 14 : (_ann.tool === 'pen' ? 3 : 1);
      const widthMedia = localLengthForScreenPx(scene.svg, _ann.widths?.[_ann.tool === 'marker' ? 'marker' : 'pen'] || baseWidthScreen);
      active = { scene, tool: _ann.tool, path: [[local.x, local.y]], widthMedia, previewEl: null };
      _ann.drawing = true;
    }
    function move(clientX, clientY) {
      if (!active) return;
      const local = clientToLocal(active.scene.svg, clientX, clientY);
      active.path.push([local.x, local.y]);
      const ellipseTool = active.tool === 'ellipse-line' || active.tool === 'ellipse-fill';
      const rectTool = active.tool === 'rect' || active.tool === 'rect-line';
      const tag = active.tool === 'lasso' ? 'polygon' : (ellipseTool ? 'ellipse' : (rectTool ? 'rect' : 'path'));
      if (!active.previewEl || active.previewEl.tagName.toLowerCase() !== tag) {
        active.previewEl?.remove();
        active.previewEl = document.createElementNS(NS, tag);
        active.previewEl.classList.add('viewer-ann-preview');
        active.previewEl.style.pointerEvents = 'none';
        active.scene.strokesG.appendChild(active.previewEl);
      }
      if (ellipseTool || rectTool) {
        const data = ellipseTool ? _ellipseData(active.path) : _rectData(active.path);
        data.lineWidth = active.widthMedia;
        const replacement = renderShape(active.scene, active.tool, data, _ann.color, _ann.opacity, null, true);
        active.previewEl.remove();
        active.previewEl = replacement;
        active.previewEl.classList.add('viewer-ann-preview');
        active.previewEl.style.pointerEvents = 'none';
      } else if (active.tool === 'lasso') {
        active.previewEl.setAttribute('points', active.path.map(p => p[0] + ',' + p[1]).join(' '));
        active.previewEl.setAttribute('fill', _ann.color); active.previewEl.setAttribute('fill-opacity', '0.2');
        active.previewEl.setAttribute('stroke', _ann.color); active.previewEl.setAttribute('stroke-dasharray', String(active.widthMedia) + ',' + String(active.widthMedia));
      } else {
        active.previewEl.setAttribute('d', _pathD(active.path));
        active.previewEl.setAttribute('fill', 'none'); active.previewEl.setAttribute('stroke', _ann.color);
        active.previewEl.setAttribute('stroke-width', String(active.widthMedia));
        active.previewEl.setAttribute('stroke-opacity', active.tool === 'marker' ? String(_normalizeOpacity(_ann.opacity, 1) * 0.5) : String(_normalizeOpacity(_ann.opacity, 1)));
        active.previewEl.setAttribute('stroke-linecap', active.tool === 'marker' ? 'butt' : 'round'); active.previewEl.setAttribute('stroke-linejoin', 'round');
      }
    }
    async function end() {
      if (!active) return;
      const { scene, tool, path, widthMedia } = active;
      active.previewEl?.remove();
      active = null;
      _ann.drawing = false;
      if (path.length < 2) return;
      const shapeTypes = new Set(['rect', 'rect-line', 'ellipse-line', 'ellipse-fill']);
      const type = shapeTypes.has(tool) ? tool : (tool === 'lasso' ? 'lasso' : (tool === 'marker' ? 'marker' : (tool === 'polyline' ? 'polyline' : 'stroke')));
      const data = type.startsWith('ellipse') ? _ellipseData(path) : (shapeTypes.has(type) ? _rectData(path) : { points: path, width: widthMedia });
      if (shapeTypes.has(type)) data.lineWidth = widthMedia;
      data.coordinateSpace = COORD_SPACE;
      data.mediaWidth = scene.mediaWidth;
      data.mediaHeight = scene.mediaHeight;
      if (scene.isPdf && scene.pageIndex != null) data.pageIndex = scene.pageIndex;
      const el = shapeTypes.has(type) ? renderShape(scene, type, data, _ann.color, _ann.opacity, null, false) : renderStroke(scene, type, path, _ann.color, _ann.opacity, null, widthMedia);
      try {
        const res = await window.apiPost('/annotations', {
          target_path: scene.path, type, data, color: _ann.color, opacity: _ann.opacity, user: viewerAnnotationUser(),
        });
        // 保存完了までにページ送り等でシーンが差し替わっていても、要素自体への id 付与は無害
        // （表示から外れたSVGは破棄済みで、以後参照されない）。
        if (res?.id) el.dataset.annId = res.id;
        window.__viewerAnnotationReportSave?.(true, 'create', null, res);
      } catch (error) {
        el.remove();
        viewerAnnotationSaveFailed(error);
        window.__viewerAnnotationReportSave?.(false, 'create', error);
      }
    }
    function isDrawing() { return !!active; }
    function activeScene() { return active?.scene || null; }
    return { begin, move, end, reset, isDrawing, activeScene };
  })();

  function viewerAnnotationUser() {
    try { return JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous'; } catch { return 'anonymous'; }
  }
  let _lastSaveFailureAt = 0;
  function viewerAnnotationSaveFailed(error, message = '注釈の保存に失敗しました') {
    const now = Date.now();
    if (typeof window.showStatus === 'function' && now - _lastSaveFailureAt > 1500) {
      window.showStatus(message, true);
      _lastSaveFailureAt = now;
    }
    try { console.warn(message, error); } catch {}
  }

  async function _eraseAt(scene, clientX, clientY) {
    const local = clientToLocal(scene.svg, clientX, clientY);
    const tolerance = localLengthForScreenPx(scene.svg, 10);
    const els = Array.from(scene.strokesG.querySelectorAll('path, polygon, rect')).reverse();
    for (const el of els) {
      if (el.classList.contains('viewer-ann-preview')) continue;
      if (typeof window._coreAnnotationElementHit === 'function' && window._coreAnnotationElementHit(el, local.x, local.y, tolerance)) {
        try {
          const result = el.dataset.annId ? await window.apiDelete('/annotations/' + encodeURIComponent(el.dataset.annId)) : null;
          el.remove();
          window.__viewerAnnotationReportSave?.(true, 'delete', null, result);
        } catch (error) {
          viewerAnnotationSaveFailed(error, '注釈を削除できませんでした');
          window.__viewerAnnotationReportSave?.(false, 'delete', error);
        }
        return true;
      }
    }
    const noteHit = window.MeldexViewerAnnotationNotes?.eraseAt?.(scene, local.x, local.y);
    if (noteHit) return true;
    return window.MeldexViewerAnnotationLegacy?.eraseAt?.(clientX, clientY) || false;
  }

  // ============================================================
  // ポインタ入力の配線（シーン単位。各シーンのSVGは自分の矩形内だけをカバーするため、
  // どのシーン向けの描画かはブラウザの通常のヒットテストに任せられる）
  // ============================================================

  function _bindScenePointerEvents(scene) {
    scene.svg.addEventListener('pointerdown', async (e) => {
      if (!_ann.active || e.button !== 0) return;
      if (_ann.tool === 'sticky') {
        window.MeldexViewerAnnotationNotes?.createAt?.(scene, e.clientX, e.clientY);
        return;
      }
      if (_ann.tool === 'eraser') {
        _eraseAt(scene, e.clientX, e.clientY);
        return;
      }
      e.preventDefault();
      _draw.begin(scene, e.clientX, e.clientY);
      try { scene.svg.setPointerCapture(e.pointerId); } catch {}
    });
    scene.svg.addEventListener('pointermove', (e) => {
      if (!_draw.isDrawing() || _draw.activeScene() !== scene) return;
      const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
      for (const sample of samples?.length ? samples : [e]) _draw.move(sample.clientX, sample.clientY);
      if (samples?.length) _draw.move(e.clientX, e.clientY);
    });
    scene.svg.addEventListener('pointerup', () => {
      if (!_draw.isDrawing() || _draw.activeScene() !== scene) return;
      _draw.end();
    });
    scene.svg.addEventListener('pointercancel', () => {
      if (_draw.activeScene() === scene) _draw.reset();
    });
  }

  // ============================================================
  // 読み込み・状態反映
  // ============================================================

  async function _loadScene(sceneEntry, token) {
    try {
      if (/^blob:/i.test(String(sceneEntry.path || ''))) {
        window.MeldexViewerAnnotationLegacy?.setItemsForPath?.(sceneEntry.path, []);
        return;
      }
      const items = await window.apiFetch('/annotations?target=' + encodeURIComponent(sceneEntry.path));
      if (token !== _rebuildToken) return;
      const legacyItems = [];
      (items || []).forEach(item => {
        let data = {};
        try { data = item.data ? (typeof item.data === 'string' ? JSON.parse(item.data) : item.data) : {}; }
        catch { return; }
        if (!data || data.coordinateSpace !== COORD_SPACE) {
          legacyItems.push(item);
          return;
        }
        if (item.type === 'comment' || item.shape === 'sticky') {
          window.MeldexViewerAnnotationNotes?.render?.(sceneEntry, item, data);
        } else if (['rect', 'rect-line', 'ellipse-line', 'ellipse-fill'].includes(item.type)) {
          renderShape(sceneEntry, item.type, data, item.color, item.opacity, item.id, false);
        } else if (data.points) {
          renderStroke(sceneEntry, item.type, data.points, item.color, item.opacity, item.id, data.width);
        }
      });
      window.MeldexViewerAnnotationLegacy?.setItemsForPath?.(sceneEntry.path, legacyItems);
      if (!sceneEntry._bound) {
        _bindScenePointerEvents(sceneEntry);
        sceneEntry._bound = true;
      }
    } catch (error) {
      if (token === _rebuildToken) viewerAnnotationSaveFailed(error, '注釈を読み込めませんでした');
    }
  }

  function setState(active) {
    _ann.active = !!active;
    _scenes.forEach(scene => {
      scene.svg.style.pointerEvents = _ann.active ? 'auto' : 'none';
      scene.svg.style.cursor = _ann.active ? annotationCursor() : '';
    });
    window.MeldexViewerAnnotationNotes?.setInteractive?.(_ann.active);
    window.MeldexViewerAnnotationLegacy?.setState?.(_ann.active, _ann);
    if (!_ann.active) _draw.reset();
  }
  function toggle(active) {
    const next = active === undefined ? !_ann.active : !!active;
    setState(next);
    return next;
  }
  function setTool(tool) {
    _ann.tool = tool;
    _scenes.forEach(scene => {
      if (_ann.active) scene.svg.style.cursor = annotationCursor(tool);
    });
  }
  // 表示/非表示（active=描画・編集可否とは独立）。非表示中は消しゴム等の操作対象からも外れる
  // （svgのdisplay:noneでポインタイベント自体が発生しなくなるため、pointer-events側の変更は不要）。
  function setVisible(visible) {
    _ann.visible = visible !== false;
    _scenes.forEach(scene => { scene.svg.style.display = _ann.visible ? '' : 'none'; });
  }
  function setColor(color) { _ann.color = color; }
  function setOpacity(opacity) {
    _ann.opacity = _normalizeOpacity(opacity, 1);
    _scenes.forEach(scene => { scene.svg.style.opacity = _ann.opacity; });
    window.MeldexViewerAnnotationLegacy?.setOpacity?.(_ann.opacity);
  }
  function flushDrawing() {
    if (_draw.isDrawing()) { _draw.end(); return true; }
    return false;
  }

  window.MeldexViewerAnnotationScene = {
    COORD_SPACE,
    rebuild,
    getScenes,
    findSceneByPath,
    findSceneForClientPoint,
    clientToLocal,
    localToClient,
    localLengthForScreenPx,
    renderStroke,
    renderRect,
    renderShape,
    ann,
    setState,
    toggle,
    setTool,
    setColor,
    setVisible,
    setOpacity,
    flushDrawing,
    isDrawing: () => _draw.isDrawing(),
    viewerAnnotationUser,
    viewerAnnotationSaveFailed,
  };
})();
