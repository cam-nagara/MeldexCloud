/* viewer-annotation-legacy.js — Meldexビューワー: 旧座標系（coordinateSpaceを持たない）注釈の
   後方互換オーバーレイ。
   計画: app/docs/viewer-stability-common-ui-gap-fix-plan-2026-08-04.md「実装変更 > 3」
   「旧形式は初回安定表示シーンの画面座標を逆行列でメディア座標へ変換しメモリ上で追従」

   方針（前身計画からの変更点）:
     - 旧仕様の注釈は、以前は「#display全体を基準にした固定オーバーレイ」（ズーム/パン/反転には
       追従しない）にそのまま描画していた。今回、対象シーン（viewer-annotation-scene.js）が
       読み込まれるたびに、旧座標（#display基準の生CSS px、#displayの現在のrotate/flipのみ
       反映済み）を、非表示の参照フレームSVGのgetScreenCTM()でクライアント座標へ、続けて
       対象シーンの逆行列（clientToLocal）でメディアピクセル座標へ変換し、変換結果を
       シーン本体のSVG（scene.strokesG / scene.notesG）へ直接描画するよう変更した。
       これにより、変換後は新形式と同じCSS変換連鎖（フィット×ズーム×パン×回転×反転）へ
       自動的に追従する（JS側で再計算しない）。
     - 変換はシーンが読み込まれるたびに、その時点の表示状態を基準にやり直す
       （＝「初回安定表示」を「今回このシーンを表示した時点」の意味で扱う。過去の表示状態を
       記憶して補正することはしない。これは前身仕様と同じ「破壊的変換をしない」制約の範囲内）。
     - 変換結果はメモリ上でのみ保持し、サーバーへは書き戻さない。ストローク・矩形は編集操作が
       存在しないため常に読み込み専用。付箋のみ、実際にドラッグ/リサイズ/しっぽ編集/文字編集が
       発生した時点で viewer-annotation-notes.js の通常の保存経路（_persist）により
       coordinateSpace: "media-pixel-v1" 付きで保存される（一括移行はしない）。
     - 旧しっぽは付箋相対座標（{startX,startY,endX,endY} は付箋の左上原点(data.x,data.y)からの
       相対オフセット）を、まず絶対座標（#display基準の生CSS px）へ戻してから、
       付箋本体と同じ変換パイプラインでメディア座標へ変換する。
   公開: window.MeldexViewerAnnotationLegacy */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function SceneEngine() { return window.MeldexViewerAnnotationScene; }
  function NotesEngine() { return window.MeldexViewerAnnotationNotes; }

  // #display基準の座標参照フレーム。描画はせず、getScreenCTM()による座標変換専用に使う
  // （#displayの現在のrotate/flip込みのCTMを得るため、#displayの子として実際にマウントする）。
  let _refSvg = null;

  function _ensureRefFrame() {
    if (_refSvg && _refSvg.isConnected) return _refSvg;
    const display = document.getElementById('display');
    if (!display) return null;
    _refSvg = document.createElementNS(NS, 'svg');
    _refSvg.id = 'viewer-ann-legacy-refframe';
    _refSvg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;opacity:0;pointer-events:none;';
    display.appendChild(_refSvg);
    return _refSvg;
  }

  // 旧座標(#display基準の生CSS px、#displayの現在のtransform込み) → 対象シーンのメディア座標。
  function _legacyPointToMedia(scene, x, y) {
    const ref = _ensureRefFrame();
    const ctm = ref && ref.getScreenCTM();
    if (!ctm) return { x, y };
    const client = new DOMPoint(x, y).matrixTransform(ctm);
    return SceneEngine().clientToLocal(scene.svg, client.x, client.y);
  }
  function _legacyPointsToMedia(scene, points) {
    return (points || []).map(([x, y]) => {
      const p = _legacyPointToMedia(scene, Number(x) || 0, Number(y) || 0);
      return [p.x, p.y];
    });
  }
  // 旧座標系での長さ(px)をシーンのメディア座標系での長さへ変換する（2点間の距離で計測。
  // #displayのtransformは相似変換[平行移動+拡縮+回転]のためこの方法で正確に変換できる）。
  function _legacyLengthToMedia(scene, lengthPx) {
    const a = _legacyPointToMedia(scene, 0, 0);
    const b = _legacyPointToMedia(scene, lengthPx, 0);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  // 矩形四隅をすべて変換してから外接矩形を取る（#displayのtransformに相対回転がないため、
  // 変換後も軸並行の矩形になる。符号反転[反転表示]にも頑健）。
  function _legacyRectToMedia(scene, data) {
    const x = Number(data.x) || 0, y = Number(data.y) || 0;
    const w = Number(data.width) || 0, h = Number(data.height) || 0;
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      .map(([px, py]) => _legacyPointToMedia(scene, px, py));
    const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  function _isNoteItem(item, data) {
    if (!item || data?.deleted) return false;
    const type = String(item.type || '');
    const shape = String(item.shape || data?.shape || '');
    const hasPosition = data && (data.x != null || data.y != null || data.width != null || data.height != null);
    if (type === 'comment') return shape === 'sticky' || data?.noteType === 'sticky' || hasPosition;
    return type === 'note' || type === 'sticky';
  }

  function _renderConvertedStroke(scene, item, data) {
    const points = _legacyPointsToMedia(scene, data.points || []);
    if (points.length < 2) return;
    const fallbackPx = data.width || (item.type === 'marker' ? 12 : (item.type === 'lasso' ? 1 : 3));
    const widthMedia = _legacyLengthToMedia(scene, fallbackPx);
    SceneEngine().renderStroke(scene, item.type, points, item.color, item.opacity, item.id, widthMedia);
  }

  function _renderConvertedRect(scene, item, data) {
    const rect = _legacyRectToMedia(scene, data);
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    SceneEngine().renderRect(scene, rect, item.color, item.opacity, item.id);
  }

  // 旧しっぽ({startX,startY,endX,endY}は付箋左上origin相対) → 絶対(#display基準px) → メディア座標
  function _convertLegacyTail(scene, noteData) {
    const tail = noteData.tail;
    if (!tail) return null;
    const originX = Number(noteData.x) || 0, originY = Number(noteData.y) || 0;
    const startAbs = { x: originX + (Number(tail.startX) || 0), y: originY + (Number(tail.startY) || 0) };
    const endAbs = { x: originX + (Number(tail.endX) || 0), y: originY + (Number(tail.endY) || 0) };
    const start = _legacyPointToMedia(scene, startAbs.x, startAbs.y);
    const end = _legacyPointToMedia(scene, endAbs.x, endAbs.y);
    return { startX: start.x, startY: start.y, endX: end.x, endY: end.y };
  }

  function _renderConvertedNote(scene, item, data) {
    const rect = _legacyRectToMedia(scene, data);
    const newData = {
      x: rect.x, y: rect.y,
      width: rect.width > 20 ? rect.width : 180,
      height: rect.height > 20 ? rect.height : 100,
      text: data.text || '',
      // 表示時点で新形式のシーン座標(media-pixel-v1)へ変換済みであることを明示する。
      // サーバーへは、この付箋が実際に編集・保存された時点（ドラッグ/リサイズ/しっぽ/文字編集）
      // にのみ書き戻される（viewer-annotation-notes.jsの通常の保存経路 _persist 経由）。
      coordinateSpace: SceneEngine().COORD_SPACE,
      mediaWidth: scene.mediaWidth, mediaHeight: scene.mediaHeight,
    };
    if (scene.isPdf && scene.pageIndex != null) newData.pageIndex = scene.pageIndex;
    const tail = _convertLegacyTail(scene, data);
    if (tail) newData.tail = tail;
    NotesEngine()?.render?.(scene, { id: item.id, color: item.color }, newData);
  }

  // rebuild()は互換のため残置（viewer-annotation-scene.jsのrebuild()から無条件で呼ばれる）。
  // 実際の描画はシーンごとの読み込み完了時にsetItemsForPathが行うため、ここでは何もしない。
  function rebuild() {}

  function setItemsForPath(path, items) {
    const scene = SceneEngine()?.findSceneByPath?.(path);
    if (!scene) return; // 対象シーンが見つからない場合は何もしない（旧データは無変更のまま）
    (items || []).forEach(item => {
      let data = {};
      try { data = item.data ? (typeof item.data === 'string' ? JSON.parse(item.data) : item.data) : {}; }
      catch { return; }
      if (_isNoteItem(item, data)) { _renderConvertedNote(scene, item, data); return; }
      if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') return;
      if (item.type === 'rect' && data.width != null && data.height != null) { _renderConvertedRect(scene, item, data); return; }
      if (data.points) _renderConvertedStroke(scene, item, data);
    });
  }

  // 旧ストローク/矩形/付箋は、変換後はすべてシーン本体（scene.strokesG / NotesEngine管理下）
  // へ描画されるため、消しゴム・表示/非表示・透明度は viewer-annotation-scene.js /
  // viewer-annotation-notes.js の既存経路がそのまま処理する。以下はAPI互換のための薄い委譲のみ。
  function setState() {}
  function setOpacity() {}
  function eraseAt() { return false; }

  window.MeldexViewerAnnotationLegacy = {
    rebuild,
    setItemsForPath,
    setState,
    setOpacity,
    eraseAt,
  };
})();
