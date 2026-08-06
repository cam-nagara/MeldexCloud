/* viewer-annotation-notes.js — Meldexビューワー: 新座標系(media-pixel-v1)の付箋＋しっぽ。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 3. 注釈の画像追従」
   方針:
     - 付箋本体・文字・しっぽ・ハンドルは、対応するシーン(viewer-annotation-scene.js)のSVG内
       <foreignObject> として描画する。SVGのviewBoxスケーリングにより、フィット倍率×ズーム×
       パン×回転×反転が自動的にストロークと同じ変換対象になる（JS側で個別計算しない）。
     - しっぽは gb-annotation-tails.js（ボード等の「対象要素に追従する」しっぽ）とは別実装。
       単独ビューワーの画像には「対象要素」という概念がないため、始点/終点を画像固有ピクセル座標
       で保持するだけの単純なしっぽにする（{startX, startY, endX, endY} をシーンのローカル座標系
       で保持。gb-annotation-tails.jsの同名フィールドとは異なりnote相対ではなくシーン絶対座標）。
     - 座標は保存時に必ず coordinateSpace: "media-pixel-v1" を付与する（新規作成のみ扱う。
       旧座標の付箋は viewer-annotation-legacy.js が担当し、ドラッグで移動・保存された時点で
       このモジュールの新形式へ昇格する）。
   公開: window.MeldexViewerAnnotationNotes */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const XHTML = 'http://www.w3.org/1999/xhtml';

  function SceneEngine() { return window.MeldexViewerAnnotationScene; }

  function _saveFailed(error, message) { SceneEngine().viewerAnnotationSaveFailed(error, message); }
  function _user() { return SceneEngine().viewerAnnotationUser(); }

  function _clampMin(value, min) { return Math.max(min, Number(value) || 0); }

  function _buildNoteDom(scene, annId, data, color) {
    const fo = document.createElementNS(NS, 'foreignObject');
    fo.classList.add('viewer-ann-note-fo');
    fo.dataset.annId = annId || '';
    const width = _clampMin(data.width, 60);
    const height = _clampMin(data.height, 40);
    fo.setAttribute('x', Number(data.x) || 0);
    fo.setAttribute('y', Number(data.y) || 0);
    fo.setAttribute('width', width);
    fo.setAttribute('height', height);

    const note = document.createElementNS(XHTML, 'div');
    note.className = 'viewer-ann-note';
    note.style.background = color || '#c48080';

    const textarea = document.createElementNS(XHTML, 'textarea');
    textarea.className = 'viewer-ann-note-textarea';
    textarea.value = data.text || '';
    note.appendChild(textarea);

    const tailShape = document.createElementNS(NS, 'polygon');
    tailShape.classList.add('viewer-ann-tail-shape');
    const handleStart = document.createElementNS(NS, 'circle');
    handleStart.classList.add('viewer-ann-tail-handle');
    handleStart.dataset.tailHandle = 'start';
    const handleEnd = document.createElementNS(NS, 'circle');
    handleEnd.classList.add('viewer-ann-tail-handle');
    handleEnd.dataset.tailHandle = 'end';

    fo.appendChild(note);
    return { fo, note, textarea, tailShape, handleStart, handleEnd };
  }

  function _updateTailDom(scene, entry) {
    const tail = entry.data.tail;
    if (!tail) {
      entry.tailShape.remove();
      entry.handleStart.remove();
      entry.handleEnd.remove();
      return;
    }
    if (!entry.tailShape.parentNode) scene.notesG.insertBefore(entry.tailShape, entry.fo);
    if (!entry.handleStart.parentNode) scene.notesG.appendChild(entry.handleStart);
    if (!entry.handleEnd.parentNode) scene.notesG.appendChild(entry.handleEnd);
    const sx = Number(tail.startX) || 0, sy = Number(tail.startY) || 0;
    const ex = Number(tail.endX) || 0, ey = Number(tail.endY) || 0;
    const dx = ex - sx, dy = ey - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const half = SceneEngine().localLengthForScreenPx(scene.svg, 8);
    const nx = -dy / len * half, ny = dx / len * half;
    entry.tailShape.setAttribute('points', [
      [sx + nx, sy + ny], [sx - nx, sy - ny], [ex, ey],
    ].map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '));
    entry.tailShape.setAttribute('fill', entry.color || '#c48080');
    entry.tailShape.setAttribute('stroke', entry.color || '#c48080');
    const handleR = SceneEngine().localLengthForScreenPx(scene.svg, 5);
    entry.handleStart.setAttribute('cx', sx); entry.handleStart.setAttribute('cy', sy); entry.handleStart.setAttribute('r', handleR);
    entry.handleEnd.setAttribute('cx', ex); entry.handleEnd.setAttribute('cy', ey); entry.handleEnd.setAttribute('r', handleR);
    entry.handleStart.classList.add('viewer-ann-tail-handle');
    entry.handleEnd.classList.add('viewer-ann-tail-handle');
    // ハンドルは注釈モードON時のみ操作可能にする（徹底チェック2026-08-02: 以前は_ann.activeに
    // 関係なく常時autoだったため、注釈OFF時もこの円が下のページ送り領域・パン操作のクリックを
    // 奪っていた）。tailShape自体は装飾のみで常にnone（既存のまま変更なし）。
    const active = !!SceneEngine().ann().active;
    entry.tailShape.style.pointerEvents = 'none';
    entry.handleStart.style.pointerEvents = active ? 'auto' : 'none';
    entry.handleEnd.style.pointerEvents = active ? 'auto' : 'none';
  }

  async function _persist(entry) {
    if (!entry.annId) return;
    try {
      await window.apiPut('/annotations/' + encodeURIComponent(entry.annId), { data: { ...entry.data } });
      window.__viewerAnnotationReportSave?.(true, 'update');
    } catch (error) {
      _saveFailed(error);
      window.__viewerAnnotationReportSave?.(false, 'update', error);
    }
  }

  function _scheduleSave(entry) {
    clearTimeout(entry.saveTimer);
    entry.saveTimer = setTimeout(() => _persist(entry), 250);
  }

  function _setTail(scene, entry, tail) {
    entry.data.tail = tail;
    _updateTailDom(scene, entry);
    _persist(entry);
  }
  function _removeTail(scene, entry) {
    delete entry.data.tail;
    _updateTailDom(scene, entry);
    _persist(entry);
  }

  function _installTailDrag(scene, entry) {
    entry.note.addEventListener('pointerdown', (e) => {
      if (!e.altKey || e.button !== 0 || e.target.closest('textarea')) return;
      e.preventDefault(); e.stopPropagation();
      const start = SceneEngine().clientToLocal(scene.svg, e.clientX, e.clientY);
      const draft = { startX: start.x, startY: start.y, endX: start.x, endY: start.y };
      entry.data.tail = draft;
      _updateTailDom(scene, entry);
      const onMove = (ev) => {
        const pt = SceneEngine().clientToLocal(scene.svg, ev.clientX, ev.clientY);
        draft.endX = pt.x; draft.endY = pt.y;
        _updateTailDom(scene, entry);
      };
      const onUp = (ev) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const noteRect = entry.note.getBoundingClientRect();
        const outside = ev.clientX < noteRect.left || ev.clientX > noteRect.right || ev.clientY < noteRect.top || ev.clientY > noteRect.bottom;
        if (!outside) { _removeTail(scene, entry); return; }
        _setTail(scene, entry, draft);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    [entry.handleStart, entry.handleEnd].forEach(handle => {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const which = handle.dataset.tailHandle;
        const onMove = (ev) => {
          const pt = SceneEngine().clientToLocal(scene.svg, ev.clientX, ev.clientY);
          if (which === 'start') { entry.data.tail.startX = pt.x; entry.data.tail.startY = pt.y; }
          else { entry.data.tail.endX = pt.x; entry.data.tail.endY = pt.y; }
          _updateTailDom(scene, entry);
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          _persist(entry);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    });
  }

  function _installDrag(scene, entry) {
    entry.note.addEventListener('pointerdown', (e) => {
      if (e.altKey || e.target.closest('textarea') || e.button !== 0) return;
      if (SceneEngine().ann().tool === 'eraser') {
        e.preventDefault(); e.stopPropagation();
        _deleteEntry(scene, entry);
        return;
      }
      e.preventDefault(); e.stopPropagation();
      const startLocal = SceneEngine().clientToLocal(scene.svg, e.clientX, e.clientY);
      const originX = Number(entry.fo.getAttribute('x')) || 0;
      const originY = Number(entry.fo.getAttribute('y')) || 0;
      const onMove = (ev) => {
        const cur = SceneEngine().clientToLocal(scene.svg, ev.clientX, ev.clientY);
        const nx = originX + (cur.x - startLocal.x);
        const ny = originY + (cur.y - startLocal.y);
        entry.fo.setAttribute('x', nx);
        entry.fo.setAttribute('y', ny);
        if (entry.data.tail) {
          const dx = nx - (Number(entry.data.x) || 0), dy = ny - (Number(entry.data.y) || 0);
          entry.data.tail.startX = (entry.data.tail.startX || 0) + dx - (entry._tailDragAccX || 0);
          entry.data.tail.startY = (entry.data.tail.startY || 0) + dy - (entry._tailDragAccY || 0);
          entry._tailDragAccX = dx; entry._tailDragAccY = dy;
          _updateTailDom(scene, entry);
        }
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        entry.data.x = Number(entry.fo.getAttribute('x')) || 0;
        entry.data.y = Number(entry.fo.getAttribute('y')) || 0;
        entry._tailDragAccX = 0; entry._tailDragAccY = 0;
        _persist(entry);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    entry.textarea.addEventListener('blur', () => {
      entry.data.text = entry.textarea.value;
      _persist(entry);
    });
    const resizeObserver = new ResizeObserver(() => {
      const width = _clampMin(entry.textarea.offsetWidth + 16, 60);
      const height = _clampMin(entry.textarea.offsetHeight + 16, 40);
      if (width === entry.data.width && height === entry.data.height) return;
      entry.data.width = width;
      entry.data.height = height;
      entry.fo.setAttribute('width', width);
      entry.fo.setAttribute('height', height);
      _scheduleSave(entry);
    });
    resizeObserver.observe(entry.textarea);
    entry.resizeObserver = resizeObserver;
  }

  async function _deleteEntry(scene, entry) {
    try {
      if (entry.annId) await window.apiDelete('/annotations/' + encodeURIComponent(entry.annId));
      entry.resizeObserver?.disconnect();
      entry.fo.remove();
      entry.tailShape.remove();
      entry.handleStart.remove();
      entry.handleEnd.remove();
      scene.notes = (scene.notes || []).filter(n => n !== entry);
      window.__viewerAnnotationReportSave?.(true, 'delete');
    } catch (error) {
      _saveFailed(error, '付箋を削除できませんでした');
      window.__viewerAnnotationReportSave?.(false, 'delete', error);
    }
  }

  function render(scene, item, data) {
    const dom = _buildNoteDom(scene, item.id, data, item.color);
    const entry = {
      annId: item.id, data: { ...data }, color: item.color,
      fo: dom.fo, note: dom.note, textarea: dom.textarea,
      tailShape: dom.tailShape, handleStart: dom.handleStart, handleEnd: dom.handleEnd,
      saveTimer: 0,
    };
    scene.notesG.appendChild(entry.fo);
    entry.note.style.pointerEvents = SceneEngine().ann().active ? 'auto' : 'none';
    _updateTailDom(scene, entry);
    _installDrag(scene, entry);
    _installTailDrag(scene, entry);
    scene.notes = scene.notes || [];
    scene.notes.push(entry);
    return entry;
  }

  async function createAt(scene, clientX, clientY) {
    const local = SceneEngine().clientToLocal(scene.svg, clientX, clientY);
    const data = {
      x: local.x, y: local.y, width: 180, height: 100, text: '',
      coordinateSpace: SceneEngine().COORD_SPACE,
      mediaWidth: scene.mediaWidth, mediaHeight: scene.mediaHeight,
    };
    if (scene.isPdf && scene.pageIndex != null) data.pageIndex = scene.pageIndex;
    const color = SceneEngine().ann().color;
    try {
      const res = await window.apiPost('/annotations', {
        target_path: scene.path, type: 'comment', shape: 'sticky', data, color, opacity: SceneEngine().ann().opacity, user: _user(),
      });
      render(scene, { id: res?.id, color }, data);
      window.__viewerAnnotationReportSave?.(true, 'create');
    } catch (error) {
      _saveFailed(error, '付箋作成に失敗しました');
      window.__viewerAnnotationReportSave?.(false, 'create', error);
    }
  }

  function setInteractive(active) {
    (SceneEngine().getScenes() || []).forEach(scene => {
      (scene.notes || []).forEach(entry => {
        entry.note.style.pointerEvents = active ? 'auto' : 'none';
        // しっぽハンドルも同期させる（_updateTailDomは再描画時にしか呼ばれないため、
        // モード切替だけの場合はここで既存ハンドルの状態も合わせて更新する必要がある）。
        entry.handleStart.style.pointerEvents = active ? 'auto' : 'none';
        entry.handleEnd.style.pointerEvents = active ? 'auto' : 'none';
      });
    });
  }

  function eraseAt(scene, localX, localY) {
    const notes = scene.notes || [];
    for (let i = notes.length - 1; i >= 0; i--) {
      const entry = notes[i];
      const x = Number(entry.fo.getAttribute('x')) || 0;
      const y = Number(entry.fo.getAttribute('y')) || 0;
      const w = Number(entry.fo.getAttribute('width')) || 0;
      const h = Number(entry.fo.getAttribute('height')) || 0;
      if (localX >= x - 5 && localX <= x + w + 5 && localY >= y - 5 && localY <= y + h + 5) {
        _deleteEntry(scene, entry);
        return true;
      }
    }
    return false;
  }

  window.MeldexViewerAnnotationNotes = {
    render,
    createAt,
    setInteractive,
    eraseAt,
  };
})();
