/* ==============================
   gb-note-block-reorder.js: ノート行/ブロックの並べ替え（ハンドル+キーボード）
   計画書: app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
           §4.4（本ファイルの責務） §5 工程7（ハンドル） 工程8（キーボード）
   依存:
     - gb-note-block-types.js（MeldexNoteBlockTypes: resolveCurrentBlock / EDITABLE_SELECTOR /
       isEditableWritable / captureCaretRefs / restoreCaretRefs）
     - gb-note-block-menu.js（MeldexNoteBlockMenu: ハンドルクリック時の共通行種メニュー）
     - gb-dnd-autoscroll.js（MeldexDragAutoScroll: ドラッグ中の自動スクロール）
     - gb-editor.js 系（_pushCustomUndo, flushPendingEditorAutosave, _dpSave）— 呼び出すのみ、
       これらの実装ファイル（保存系レーンの管轄）は変更しない

   旧実装は2箇所に分散し、どちらも #page-content 専用・見出しセクションラッパーを
   「移動単位」と誤認する経路があった:
     - gb-note-enhance.part01.js の _initBlockDragHandle（ネイティブHTML5 drag&drop、
       pointer capture無し、タッチはホバー表示のみでドラッグ操作自体は非対応）
     - gb-editor.part04.part01.js の moveBlock/_swapAdjacent/_moveLiAcrossBoundary（
       heading-sectionでの前後判定がpc直下まで無条件に登り、セクション単位で
       誤って移動する経路があった）
   両実装は本ファイルへ委譲する薄いラッパーへ置き換えた。ドラッグとキーボードは
   §2.4のとおり同じ論理ブロックresolver（MeldexNoteBlockTypes.resolveCurrentBlock）を使う。

   公開API: window.MeldexNoteBlockReorder / window.moveBlock（後方互換）
   ============================== */
(function (global) {
  'use strict';

  const HANDLE_ID = 'block-drag-handle';
  const DRAG_THRESHOLD = 6;      // px。工程7-4/5: 閾値未満はクリック、超えたらドラッグ
  const HANDLE_H = 20;
  const TOUCH_HANDLE_SIZE = 44;  // 工程7: タッチ操作面は44px以上

  function NBT() { return global.MeldexNoteBlockTypes; }

  function _rangeAtStartOf(block) {
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(true);
    return range;
  }

  // ============================================================
  // 1. 論理ブロックresolver（MeldexNoteBlockTypes.resolveCurrentBlockを再利用）
  // ============================================================
  // §2.4: section.heading-section は表示用ラッパーであり移動単位を変えない。
  // resolveCurrentBlockは既にこの前提でinfo.blockを返す（h1〜h6/li/callout/
  // quote/code/table/div,pのいずれか。section自体は返らない）。
  function resolveBlockAt(editable, refNodeOrRange) {
    const nbt = NBT();
    if (!nbt || !editable) return null;
    const range = (refNodeOrRange && typeof refNodeOrRange.startContainer !== 'undefined')
      ? refNodeOrRange
      : _rangeAtStartOf(refNodeOrRange);
    return nbt.resolveCurrentBlock(editable, range);
  }

  function LR() { return global.MeldexNoteLogicalRows; }

  // DOMノード起点で「現在行」を求める（ポインタ操作用）。計画書§2.1/§2.3の
  // 論理行resolver（gb-note-logical-rows.js）へ委譲する（HRを含む全17行種を
  // 網羅する正本を重複実装しない）。ハンドル自身の上では対象を解決しない。
  function _blockUnderNode(editable, node) {
    if (_handle && (node === _handle || _handle.contains(node))) return null;
    const lr = LR();
    if (!lr) return null;
    return lr.resolveRowAt(editable, node);
  }

  // ============================================================
  // 2. 前後ブロック決定（コンテナ境界内のみ。§4.4「前後ブロックを決定」）
  // ============================================================
  // キーボード（Alt+Shift+↑/↓）は1段階の隣接swapに限定する。コンテナ
  // （見出しセクションまたはeditable直下、あるいは同一リスト）の境界を
  // 越えないことで「先頭/末尾では不可」を単純かつ予測可能にする
  // （工程7-7）。ドラッグは _dragCandidates() 側でより広い移動範囲を許可する。
  function adjacentBlock(blockEl, direction) {
    let sib = direction === 'up' ? blockEl.previousElementSibling : blockEl.nextElementSibling;
    while (sib && sib.tagName === 'BR') sib = direction === 'up' ? sib.previousElementSibling : sib.nextElementSibling;
    return sib || null;
  }

  // ============================================================
  // 3. 移動プリミティブ（Undo1回・選択/キャレット保持・dirty化+既存保存予約）
  // ============================================================
  // 詳細パネル内ノート（#dp-editable）は gb-detail-panel.part03.js の _dpSave が
  // 個別のフラッシュ経路を持つ（flushPendingEditorAutosaveは対象外）。
  // メインパネル/エンティティ自由記述は既存の flushPendingEditorAutosave で
  // 両方カバーされる。単独版など、どちらも存在しない環境では 'input' の
  // dispatchのみで、その環境固有の自動保存に委ねる（保存系レーンの管轄に
  // 立ち入らない）。
  function _flushExistingSaveReservation(editable) {
    if (!editable) return;
    try {
      if (editable.id === 'dp-editable' && typeof global._dpSave === 'function') {
        global._dpSave(editable);
        return;
      }
      if (typeof global.flushPendingEditorAutosave === 'function') global.flushPendingEditorAutosave();
    } catch (err) {
      console.warn('MeldexNoteBlockReorder: save reservation flush failed', err);
    }
  }

  function _refreshTocIfNeeded() {
    const toc = document.getElementById('note-toc');
    if (toc && toc.style.display !== 'none' && typeof global.updateNoteToc === 'function') global.updateNoteToc();
  }

  // 計画書2026-08-04版§2.1: 見出しセクション（表示用ラッパー）の整合は、
  // gb-note-logical-rows.js の moveRow/placeRowRelative が操作の前後で対象ホスト
  // 全体を一時アンラップ／再ラップすることで一括して扱う（移動したブロックが
  // 見出しかどうかで場合分けする個別処理は不要になった。旧実装はここにあった）。

  // no-op（既に隣接済み等でDOMが変化しなかった）時に _pushCustomUndo が積んだ
  // エントリを巻き戻す。巻き戻さないと _customUndoInputPending が true のまま残り、
  // 次の「本物の」ユーザー入力（通常のタイピング）が誤って「カスタム操作の確定」
  // として扱われ、その入力に対してCtrl+Zを押すとカスタムundoスタックの古い状態
  // （＝直前の入力ごと）に戻ってしまう（gb-note-enhance.part03.jsの
  // _noteTableDiscardCustomUndoIfUnchangedと同じ対策パターン）。
  function _discardCustomUndoIfUnchanged(editable, beforeHtml) {
    if (!editable || beforeHtml === undefined || editable.innerHTML !== beforeHtml) return;
    if (!editable._customUndoInputPending || !Array.isArray(editable._customUndoStack)) return;
    const lastIndex = editable._customUndoStack.length - 1;
    if (lastIndex >= 0 && editable._customUndoStack[lastIndex] === beforeHtml) editable._customUndoStack.pop();
    editable._customUndoInputPending = false;
    editable._lastCustomOp = editable._customUndoStack.length > 0;
  }

  // 計画書2026-08-04版§2.1: 移動の配置判定そのもの（同一リスト内入れ替え・
  // 入れ子端の一段昇格・ルート境界での同種リスト合流・通常行との相互変換・
  // 見出しセクションの一時アンラップ／再ラップ）は gb-note-logical-rows.js
  // （MeldexNoteLogicalRows.moveRow / placeRowRelative）へ一本化した。
  // Ctrl+↑/↓（moveBlock）とドラッグ（_endDrag）はどちらも同じプリミティブを
  // 呼び、Undo・キャレット保持・dirty化・保存予約・TOC更新だけをここで共通に扱う。
  // caretRefs は生きたノード参照（クローンしない）なので、行種変換を伴わない
  // 移動はもちろん、LI⇔通常行の相互変換（子ノードを新しい要素へ「移動」するだけ）
  // でも有効なまま残る。
  function _commitRowOperation(editable, performFn) {
    const nbt = NBT();
    if (!nbt || !editable) return { ok: false, reason: 'no-editable-host' };
    if (!nbt.isEditableWritable(editable)) return { ok: false, reason: 'readonly' }; // 工程7-8: viewer/ロック中は禁止
    const sel = window.getSelection();
    const liveRange = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const caretRefs = (liveRange && editable.contains(liveRange.startContainer) && typeof nbt.captureCaretRefs === 'function')
      ? nbt.captureCaretRefs(liveRange)
      : null;
    if (typeof global._pushCustomUndo === 'function') global._pushCustomUndo(editable);
    const beforeHtml = editable.innerHTML;
    let result;
    try {
      result = performFn();
    } catch (err) {
      console.warn('MeldexNoteBlockReorder: move failed', err);
      result = { ok: false, reason: 'move-failed' };
    }
    if (!result || !result.ok) {
      // no-op/失敗: 直前にpushしたundoエントリを巻き戻す。
      _discardCustomUndoIfUnchanged(editable, beforeHtml);
      return result || { ok: false, reason: 'move-failed' };
    }
    const focusEl = result.block;
    if (caretRefs && focusEl && typeof nbt.restoreCaretRefs === 'function') nbt.restoreCaretRefs(caretRefs, focusEl);
    else if (focusEl && typeof focusEl.scrollIntoView === 'function') focusEl.scrollIntoView({ block: 'nearest' });
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    _flushExistingSaveReservation(editable);
    _refreshTocIfNeeded();
    return result;
  }

  // ============================================================
  // 4. キーボード移動（Ctrl+↑/↓。ハンドル・ドラッグと同じresolver/配置処理を使う）
  // ============================================================
  let _lastBoundaryAnnounceAt = 0;
  function _announceBoundary(direction) {
    const now = Date.now();
    if (now - _lastBoundaryAnnounceAt < 600) return; // 連打時の通知スパム防止
    _lastBoundaryAnnounceAt = now;
    if (typeof global.showStatus === 'function') {
      global.showStatus(direction === 'up' ? 'これ以上上へは移動できません' : 'これ以上下へは移動できません');
    }
  }

  // 工程8: 実フォーカス中の編集ホストから解決する（state.view依存はgb-shortcuts側の
  // _resolveShortcutScope修正で対応済み。ここでは呼び出された時点の
  // activeEditableHost()を素直に使う）。
  function moveBlock(direction) {
    const nbt = NBT();
    const lr = LR();
    if (!nbt || !lr) return { ok: false, reason: 'no-registry' };
    const editable = nbt.activeEditableHost();
    if (!editable) return { ok: false, reason: 'no-editable-host' };
    if (!nbt.isEditableWritable(editable)) return { ok: false, reason: 'readonly' };
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return { ok: false, reason: 'no-selection' };
    const range = sel.getRangeAt(0);
    if (!editable.contains(range.startContainer)) return { ok: false, reason: 'no-selection' };
    const info = nbt.resolveCurrentBlock(editable, range);
    if (!info) return { ok: false, reason: 'no-current-block' };
    const result = _commitRowOperation(editable, () => lr.moveRow(editable, info.block, direction));
    if (!result.ok && result.reason === 'boundary') _announceBoundary(direction);
    return result;
  }
  // 後方互換: gb-shortcuts.part01.js の note.moveUp/note.moveDown は
  // グローバル moveBlock() を呼ぶ（工程0時点から既存の契約。変更しない）。
  global.moveBlock = moveBlock;

  // ============================================================
  // 5. ドラッグ用: 文書順の論理行一覧（gb-note-logical-rows.js のlistRowsを使う）
  // ============================================================
  // §2.1「ドラッグにも同じ配置処理を使いCtrl移動とDOM結果を一致させる」ため、
  // ドラッグ候補もリスト項目限定にせず全論理行を対象にする。移動先確定
  // （_endDrag）は placeRowRelative に委譲し、実際の配置規則（同一リスト内
  // 入れ替え・一段昇格・同種リスト合流・通常行との相互変換）は
  // gb-note-logical-rows.js 側の1段階プリミティブと共有する。
  // 組方向の軸オラクル。未読込環境では横書き固定にフォールバックする。
  function _axis(editable) {
    const wm = global.MeldexNoteWritingMode;
    if (wm && typeof wm.axis === 'function') return wm.axis(editable);
    return {
      vertical: false,
      blockCoord: (pt) => pt.y, blockStart: (r) => r.top, blockEnd: (r) => r.bottom, blockSign: 1,
      toPoint: (input) => (typeof input === 'number' ? { x: NaN, y: input } : { x: input?.clientX ?? input?.x, y: input?.clientY ?? input?.y }),
      isBefore(r, input) { return this.toPoint(input).y < (r.top + r.bottom) / 2; },
      distanceTo(r, input) {
        const c = this.toPoint(input).y;
        if (!Number.isFinite(c)) return Infinity;
        if (c < r.top) return r.top - c;
        if (c > r.bottom) return c - r.bottom;
        return 0;
      },
      containsBlock(r, input) {
        const c = this.toPoint(input).y;
        return Number.isFinite(c) && c >= r.top && c <= r.bottom;
      },
    };
  }

  function _pointOf(e) {
    return { x: e.clientX, y: e.clientY };
  }

  function _dragCandidates(editable, draggedInfo) {
    const lr = LR();
    if (!lr) return [];
    const draggedEl = draggedInfo.block;
    return lr.listRows(editable).filter((el) => el !== draggedEl && !draggedEl.contains(el) && !el.contains(draggedEl));
  }

  // 「before」は文書順で前（横書き=中点より上 / 縦書きrl=中点より右）を意味する。
  function _nearestCandidate(candidates, draggedEl, point, editable) {
    const lr = LR();
    const ax = _axis(editable);
    let nearest = null;
    let nearestDist = Infinity;
    for (const cand of candidates) {
      if (cand === draggedEl || cand.contains(draggedEl) || draggedEl.contains(cand)) continue;
      const rect = (lr && lr.rowOwnRect(cand, editable)) || cand.getBoundingClientRect();
      if (ax.containsBlock(rect, point)) {
        return { el: cand, before: ax.isBefore(rect, point) };
      }
      const dist = ax.distanceTo(rect, point);
      if (dist < nearestDist) {
        // 矩形の外側にいる場合は、行の開始側にいるかどうかで前後を決める
        const pt = ax.toPoint(point);
        const beforeStart = ax.blockSign > 0
          ? ax.blockCoord(pt) < ax.blockStart(rect)
          : ax.blockCoord(pt) > ax.blockStart(rect);
        nearestDist = dist;
        nearest = { el: cand, before: beforeStart };
      }
    }
    return nearest;
  }

  // ============================================================
  // 6. ハンドル: 表示（hover/touch、全編集ホスト共通）
  // ============================================================
  let _handle = null;
  let _hoverTargetBlock = null;
  let _hoverEditable = null;
  let _activeDrag = null;
  let _lastTouchTs = 0; // タッチ直後の合成mousemove判定用

  function _setTouchMode(enabled) {
    const size = enabled ? TOUCH_HANDLE_SIZE : HANDLE_H;
    _handle.classList.toggle('block-drag-handle--touch', !!enabled);
    _handle.style.width = size + 'px';
    _handle.style.height = size + 'px';
    _handle.style.fontSize = enabled ? '20px' : '16px';
  }

  // ユーザー指示(2026-08-05): ハンドルは全行で同じガター位置に固定する。
  //   - 横書き: 行のインデントやマウスYに追従せず、編集ホストのコンテンツ左端から
  //     22px左のガター（従来の非インデント行と同じ列）× 行の上端に置く。
  //   - 縦書き(vertical-writing。行=縦の列): 上記の鏡映しとして、コンテンツ上端から
  //     22px上のガター × 行(列)の左端に置く（全列で縦位置が一定になる）。
  //     旧実装のまま左端固定にすると全列のハンドルが同一点へ重なるため。
  function _positionHandle(editable, blockRect) {
    const z = (typeof global._getZoom === 'function') ? global._getZoom() : 1;
    // getBoundingClientRect はズーム適用済み（物理）値、getComputedStyle は
    // 論理値を返すため、パディングは z を掛けて座標系を揃えてから合成する。
    const er = editable.getBoundingClientRect();
    let padLeft = 0;
    let padTop = 0;
    try {
      const cs = getComputedStyle(editable);
      padLeft = parseFloat(cs.paddingLeft) || 0;
      padTop = parseFloat(cs.paddingTop) || 0;
    } catch (_) { /* 計測不能時は0扱い */ }
    const vertical = _axis(editable).vertical;
    _handle.classList.toggle('is-note-vertical', vertical);
    if (vertical) {
      const contentTop = er.top + padTop * z;
      _handle.style.top = (Math.max(2, contentTop - 22) / z) + 'px';
      _handle.style.left = (blockRect.left / z) + 'px';
      return;
    }
    _handle.style.top = (blockRect.top / z) + 'px';
    const contentLeft = er.left + padLeft * z;
    _handle.style.left = (Math.max(2, contentLeft - 22) / z) + 'px';
  }

  function _hideHandle() {
    if (_handle) _handle.style.opacity = '0';
    _hoverTargetBlock = null;
    _hoverEditable = null;
    if (LR()) LR().hideRowHighlight();
  }

  function _onDocumentMouseMove(e) {
    if (_activeDrag) return; // ドラッグ中は再配置しない
    // 計画書§2.3: 行種変更メニュー・右クリックメニューは document.body 直下に
    // 開かれ editable の外にあるため、そこへマウスが移動しても対象行のハンドル・
    // ハイライトを消さない（従来はここで無条件に _hideHandle() が呼ばれ、
    // メニュー操作中に表示が途切れていた）。
    if (e.target && e.target.closest && e.target.closest('.note-block-menu, .gb-context-menu')) return;
    // タップ直後にブラウザが発行する合成mousemoveを無視する。無視しないと、
    // touchstartで44pxのタッチ用ハンドルを出した直後に20pxへ縮んでしまう
    // （旧実装は同一行・微小Y移動の再配置スキップで偶然回避していた）。
    if (Date.now() - _lastTouchTs < 700) return;
    const nbt = NBT();
    const lr = LR();
    if (!nbt) return;
    if (_handle && (e.target === _handle || _handle.contains(e.target))) return; // ハンドル上では現状維持
    const editable = e.target && e.target.closest ? e.target.closest(nbt.EDITABLE_SELECTOR) : null;
    if (!editable || !nbt.isEditableWritable(editable)) { _hideHandle(); return; } // 工程7-8: viewer/ロック中は出さない
    // 修正1: 直接ブロック上でない場合（ガター/余白）は、Y座標から対応する行を探す。
    const block = _blockUnderNode(editable, e.target) || (lr && lr.rowAtPoint(editable, _pointOf(e)));
    if (!block) return; // ブロック外（余白等）: 現状維持
    const handle = _ensureHandle();
    // ユーザー指示(2026-08-05): 行テキスト・空行へのホバーではハイライト枠を出さない
    // （ハイライトはハンドル側の pointerenter / 操作中のみ）。ハンドル位置は
    // マウスYに依存しないため、対象行が変わらなくてもスクロール等のズレを
    // 吸収するよう毎回再配置する。
    _setTouchMode(false);
    const rect = (lr && lr.rowOwnRect(block, editable)) || block.getBoundingClientRect();
    _positionHandle(editable, rect);
    _hoverTargetBlock = block;
    _hoverEditable = editable;
    handle.style.opacity = '1';
  }

  function _onDocumentTouchStart(e) {
    _lastTouchTs = Date.now();
    const nbt = NBT();
    const lr = LR();
    if (!nbt) return;
    const editable = e.target && e.target.closest ? e.target.closest(nbt.EDITABLE_SELECTOR) : null;
    if (!editable || !nbt.isEditableWritable(editable)) return;
    const t = e.touches && e.touches[0];
    const block = _blockUnderNode(editable, e.target) || (t && lr ? lr.rowAtPoint(editable, _pointOf(t)) : null);
    if (!block) return;
    const handle = _ensureHandle();
    _setTouchMode(true);
    const rect = (lr && lr.rowOwnRect(block, editable)) || block.getBoundingClientRect();
    _positionHandle(editable, rect);
    // ハイライトはハンドル操作（pointerdown）時に表示する（マウスのホバーと同じ規則）。
    _hoverTargetBlock = block;
    _hoverEditable = editable;
    handle.style.opacity = '1';
  }

  // ============================================================
  // 7. ハンドル: ポインタドラッグ（工程7-1〜7-6, 7-8）
  // ============================================================
  function _clearDropIndicators(editable) {
    (editable || document).querySelectorAll('.drag-guide-top, .drag-guide-bottom').forEach((el) => {
      el.classList.remove('drag-guide-top', 'drag-guide-bottom');
    });
  }

  function _updateDropIndicator(drag, point) {
    _clearDropIndicators(drag.editable);
    const nearest = _nearestCandidate(drag.candidates, drag.blockEl, point, drag.editable);
    drag.dropTarget = nearest;
    // 工程7-7: 移動候補が1つも無い（他に動かせるブロックが無い）場合は
    // 「これ以上移動できない」ことを視覚的に示す。
    if (_handle) _handle.classList.toggle('note-block-reorder-boundary', !nearest);
    if (!nearest) return;
    nearest.el.classList.add(nearest.before ? 'drag-guide-top' : 'drag-guide-bottom');
  }

  // 修正3: 端接近による自動スクロール（gb-dnd-autoscroll.js）が進行中は、ポインタが
  // 静止していてもコンテナがスクロールし続けるため、最後のpointermove時点の座標で
  // 固定されたドロップ候補がスクロール後の実際の位置とズレる。'scroll' イベントは
  // バブリングしないため、祖先のスクロール要素も拾えるよう document の capture
  // フェーズで拾い、直近のポインタY座標でドロップ候補を再評価する。
  function _onAncestorScrollDuringDrag() {
    if (LR()) LR().refreshRowHighlight(); // ハイライト表示中ならスクロール追従させる
    const drag = _activeDrag;
    if (!drag || !drag.dragging || !drag.lastPoint) return;
    _updateDropIndicator(drag, drag.lastPoint);
  }
  document.addEventListener('scroll', _onAncestorScrollDuringDrag, true);

  // 工程11項目4: ハンドルクリックメニュー側で見出しへの「リンクをコピー」に
  // 到達させるための最小の拡張。共通行種メニュー(MeldexNoteBlockMenu)自体の
  // 項目リスト/キーボード状態機械へは手を入れず、見出し限定で「行種変更」
  // (サブメニュートリガー。gb-note-block-context-menu.js のビルダーをそのまま
  // 再利用)+「この見出しへのリンクをコピー」の2項目だけの小さなラッパーメニューを
  // 対象行の下へ開く。見出し以外は従来どおり共通行種メニューを直接開く。
  let _headingHandleMenuEl = null;
  function _closeHeadingHandleMenu() {
    if (_headingHandleMenuEl?.isConnected) _headingHandleMenuEl.remove();
    _headingHandleMenuEl = null;
  }

  function _openHeadingHandleMenu(editable, info, anchorRect) {
    _closeHeadingHandleMenu();
    if (typeof global.closeMeldexDropdowns === 'function') global.closeMeldexDropdowns();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '見出し操作メニュー');
    menu.addEventListener('mousedown', (ev) => ev.preventDefault());

    let keyCloser = null;
    const closeHeadingMenu = () => {
      if (typeof global.MeldexNoteBlockMenu !== 'undefined' && global.MeldexNoteBlockMenu.isOpen()) global.MeldexNoteBlockMenu.close();
      if (typeof global.MeldexNoteBlockContextMenu !== 'undefined') global.MeldexNoteBlockContextMenu.clearHighlight();
      if (LR()) LR().hideRowHighlight();
      if (keyCloser) { document.removeEventListener('keydown', keyCloser, true); keyCloser = null; }
      if (_headingHandleMenuEl === menu) _headingHandleMenuEl = null;
    };
    // gb-dropdown-dismiss.js の共通アウトサイドクリック処理（.gb-context-menu を
    // 対象に含む）が menu.remove() の直前に _cleanup を呼ぶ契約を使い、行種変更
    // サブメニューと対象行ハイライトを一緒に畳む（gb-note-block-menu.js と同じ方式）。
    menu._cleanup = closeHeadingMenu;

    const trigger = global.MeldexNoteBlockContextMenu.buildBlockTypeMenuTrigger({
      editable,
      blockInfo: info,
      onAfterAction: () => { closeHeadingMenu(); menu.remove(); },
    });
    menu.appendChild(trigger);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'gb-context-menu-item';
    copyBtn.setAttribute('role', 'menuitem');
    copyBtn.dataset.e2eId = 'note-heading-handle-copy-link';
    copyBtn.textContent = 'この見出しへのリンクをコピー';
    copyBtn.addEventListener('click', () => {
      closeHeadingMenu();
      menu.remove();
      global.MeldexNoteBlockContextMenu.copyHeadingLink(info.block);
    });
    menu.appendChild(copyBtn);

    document.body.appendChild(menu);
    if (typeof global.positionPopup === 'function') {
      const prefer = global.MeldexNoteWritingMode ? global.MeldexNoteWritingMode.popupPrefer(editable) : 'below';
      global.positionPopup(menu, anchorRect, { gap: 4, prefer });
    } else {
      menu.style.position = 'fixed';
      menu.style.top = anchorRect.bottom + 'px';
      menu.style.left = anchorRect.left + 'px';
      if (typeof global.clampPopupToViewport === 'function') global.clampPopupToViewport(menu);
    }
    _headingHandleMenuEl = menu;

    keyCloser = (ev) => {
      if (ev.key !== 'Escape') return;
      // サブメニュー(行種メニュー)が開いている間は、そちら自身のEscape処理
      // (gb-note-block-menu.js の document capture リスナー)を優先させる。
      if (typeof global.MeldexNoteBlockMenu !== 'undefined' && global.MeldexNoteBlockMenu.isOpen()) return;
      ev.preventDefault();
      closeHeadingMenu();
      menu.remove();
    };
    document.addEventListener('keydown', keyCloser, true);
  }

  function _openBlockMenuFor(editable, blockEl) {
    const nbt = NBT();
    const lr = LR();
    if (!nbt || typeof global.MeldexNoteBlockMenu === 'undefined') return;
    const range = _rangeAtStartOf(blockEl);
    const info = nbt.resolveCurrentBlock(editable, range) || { kind: 'body', block: blockEl };
    const currentTypeId = nbt.getBlockTypeId(info);
    const rect = blockEl.getBoundingClientRect();
    // 工程7-3: 「対象行の下へ」開く
    const anchorRect = { top: rect.bottom, bottom: rect.bottom, left: rect.left, right: rect.right };
    // 計画書§2.3: メニュー表示中も対象行のハイライトを途切れさせない。
    if (lr) lr.showRowHighlight(blockEl);

    if (info.kind === 'heading' && typeof global.MeldexNoteBlockContextMenu !== 'undefined') {
      _openHeadingHandleMenu(editable, info, anchorRect);
      return;
    }

    global.MeldexNoteBlockMenu.open({
      anchorRect,
      editable,
      range,
      blockInfo: info,
      currentTypeId,
      onSelect: (typeId) => {
        const r = _rangeAtStartOf(blockEl.isConnected ? blockEl : editable);
        nbt.convertCurrentLineTo(typeId, { editable, range: r });
        if (lr) lr.hideRowHighlight();
      },
      onClose: () => { if (lr) lr.hideRowHighlight(); },
    });
  }

  function _teardownDragListeners() {
    document.removeEventListener('pointermove', _onHandlePointerMove);
    document.removeEventListener('pointerup', _onHandlePointerUp);
    document.removeEventListener('pointercancel', _onHandlePointerCancel);
  }

  function _endDrag(commit) {
    const drag = _activeDrag;
    if (!drag) return;
    _teardownDragListeners();
    if (_handle) {
      try { _handle.releasePointerCapture(drag.pointerId); } catch (_) { /* 未捕捉時は無視 */ }
      _handle.style.cursor = 'grab';
    }
    if (typeof global.MeldexDragAutoScroll !== 'undefined') global.MeldexDragAutoScroll.endPointerSession();
    drag.blockEl.classList.remove('dragging', 'note-block-reorder-armed');
    if (_handle) _handle.classList.remove('note-block-reorder-boundary');
    _clearDropIndicators(drag.editable);
    if (commit && drag.dragging && drag.dropTarget) {
      // §2.1: ドラッグの確定もCtrl移動と同じ配置プリミティブ(placeRowRelative)を使い、
      // Undo・キャレット保持・dirty化・保存予約・TOC更新はキーボード移動と共通の
      // _commitRowOperation に揃える（DOM結果を一致させる）。
      const lr = LR();
      if (lr) {
        _commitRowOperation(drag.editable, () => lr.placeRowRelative(drag.editable, drag.blockEl, drag.dropTarget.el, drag.dropTarget.before));
      }
    }
    if (LR()) LR().hideRowHighlight();
    _activeDrag = null;
  }

  function _onHandlePointerDown(e) {
    if (e.pointerType === 'mouse' && e.button != null && e.button !== 0) return; // 左クリックのみ
    const nbt = NBT();
    const lr = LR();
    if (!nbt || !_hoverTargetBlock || !_hoverEditable) return;
    if (!nbt.isEditableWritable(_hoverEditable)) return; // 工程7-8: viewer/ロック中は禁止
    // 低重要度対策: pointerup/cancelを取りこぼした旧ドラッグが残っている状態で
    // 新しいpointerdownが来た場合、先に旧ドラッグの後片付け（コミットなし）を行う。
    if (_activeDrag) _endDrag(false);
    e.preventDefault();
    const handle = _handle;
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* 一部環境ではpointerId無効。document委譲で継続する */ }
    // 工程7-1/7-2: pointerdownの瞬間に対象ブロック全体をハイライトし、pointerup/cancelまで維持する。
    // 計画書2026-08-04版§2.3の主表示は対象行自身の矩形オーバーレイ（子リストを
    // 含まない）。note-block-reorder-armedクラス自体は既存E2E契約（targeted-note-
    // micro-handle-drag-persists-order、gb-e2e-actions-note-micro.js・対象外
    // ファイル）が状態確認に使うため、状態フラグとして後方互換で併用する
    // （そのCSS自体はgb-tools.part03.part02.css管轄で対象外。子孫を含む枠取りに
    // なるため、深いリストの正確な表示はオーバーレイ側を正とする）。
    if (lr) lr.showRowHighlight(_hoverTargetBlock);
    _hoverTargetBlock.classList.add('note-block-reorder-armed');
    _activeDrag = {
      editable: _hoverEditable,
      blockEl: _hoverTargetBlock,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      candidates: null,
      dropTarget: null,
      info: nbt.resolveCurrentBlock(_hoverEditable, _rangeAtStartOf(_hoverTargetBlock)) || { kind: 'body', block: _hoverTargetBlock },
    };
    handle.style.cursor = 'grabbing';
    document.addEventListener('pointermove', _onHandlePointerMove);
    document.addEventListener('pointerup', _onHandlePointerUp);
    document.addEventListener('pointercancel', _onHandlePointerCancel);
  }

  function _onHandlePointerMove(e) {
    const drag = _activeDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // 工程7-4: 閾値未満はまだクリック候補
      drag.dragging = true;
      drag.blockEl.classList.add('dragging');
      drag.candidates = _dragCandidates(drag.editable, drag.info);
      if (typeof global.MeldexDragAutoScroll !== 'undefined') global.MeldexDragAutoScroll.beginPointerSession(e.clientX, e.clientY);
    }
    e.preventDefault();
    // 修正3: 自動スクロール中の再評価（_onAncestorScrollDuringDrag）用。
    // 縦書きでは横位置で判定するため、片方の座標だけでなく点として保持する。
    drag.lastPoint = _pointOf(e);
    drag.lastClientY = e.clientY; // 後方互換（外部から参照している箇所がある場合のため）
    // 工程7-6: 端での自動スクロール（gb-dnd-autoscroll.js の共通基盤へ委譲）
    if (typeof global.MeldexDragAutoScroll !== 'undefined') global.MeldexDragAutoScroll.updatePointer(e.clientX, e.clientY);
    _updateDropIndicator(drag, drag.lastPoint);
  }

  function _onHandlePointerUp(e) {
    const drag = _activeDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    // 修正3: 左ボタン押下中に右クリック(別ボタン)が発生すると、そのボタンの
    // pointerup がここへ届く（同一pointerIdのため）。プライマリ(左)ボタン以外の
    // 解放でドラッグ/クリック状態を終了させると、行ハイライトが消えたり
    // 意図しないメニューが開いたりする（バグ報告§3）。左ボタンがまだ押されて
    // いる間は何もしない。
    if (e.pointerType === 'mouse' && e.button != null && e.button !== 0) return;
    if (!drag.dragging) {
      // 工程7-3: 閾値未満のクリック → 対象行の下へ共通行種メニューを開く（ドラッグは開始しない）
      _teardownDragListeners();
      if (_handle) {
        try { _handle.releasePointerCapture(drag.pointerId); } catch (_) { /* 未捕捉時は無視 */ }
        _handle.style.cursor = 'grab';
      }
      _activeDrag = null;
      _openBlockMenuFor(drag.editable, drag.blockEl);
      return;
    }
    _endDrag(true);
  }

  function _onHandlePointerCancel(e) {
    const drag = _activeDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    _endDrag(false);
  }

  // 修正3: ハンドルの右クリック。
  // - 左ボタン押下中(_activeDrag)の右クリックは、状態を壊さないよう既定メニューの
  //   表示だけ抑止する（バグ報告§3。armed状態やドラッグは _onHandlePointerUp側の
  //   ボタン判定で既に保護済みなので、ここでは何もしない）。
  // - 単独の右クリック（左ボタン非併用）は、ハンドルが対象にしている行へ、
  //   通常の右クリックメニュー（行種変更等を含む既存メニュー）を開く。
  function _onHandleContextMenu(e) {
    if (_activeDrag) { e.preventDefault(); return; }
    const nbt = NBT();
    if (!nbt || !_hoverTargetBlock || !_hoverEditable) return;
    if (!nbt.isEditableWritable(_hoverEditable)) return;
    if (typeof global._noteCtxMenuHandler !== 'function') return;
    e.preventDefault();
    const range = _rangeAtStartOf(_hoverTargetBlock);
    const blockInfo = nbt.resolveCurrentBlock(_hoverEditable, range) || { kind: 'body', block: _hoverTargetBlock, editable: _hoverEditable, hasNestedList: false };
    global._noteCtxMenuHandler(e, { editable: _hoverEditable, blockInfo });
  }

  // ユーザー指示(2026-08-05): 行ハイライト枠は、ハンドルへのカーソルオーバー中と
  // ハンドル操作中（ドラッグ・ハンドル発のメニュー表示中）だけ表示する。
  function _onHandlePointerEnter() {
    const lr = LR();
    if (lr && _hoverTargetBlock) lr.showRowHighlight(_hoverTargetBlock);
  }

  function _onHandlePointerLeave() {
    if (_activeDrag) return; // ドラッグ中の後片付けは _endDrag が行う
    // ハンドル発のメニュー（行種メニュー・見出しメニュー・右クリックメニュー）の
    // 表示中は、各メニューの close 処理がハイライトを畳む（_onDocumentMouseMove の
    // メニュー除外セレクタと同じ対象）。
    if (document.querySelector('.note-block-menu, .gb-context-menu')) return;
    if (LR()) LR().hideRowHighlight();
  }

  function _ensureHandle() {
    if (_handle && _handle.isConnected) return _handle;
    const handle = document.createElement('div');
    handle.id = HANDLE_ID;
    // グリップ記号は2列×3行の点。縦書き（行が横に並ぶ）では90度回す必要があるが、
    // ホスト側の transform は境界シェイクのアニメーションが使うため内側の span を回す。
    handle.innerHTML = '<span class="block-drag-handle-glyph">⠿</span>';
    handle.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;cursor:grab;opacity:0;transition:opacity 0.15s;color:var(--fg2);font-size:16px;display:flex;align-items:center;justify-content:center;z-index:10000;user-select:none;pointer-events:auto;touch-action:none;';
    handle.setAttribute('contenteditable', 'false');
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', 'ドラッグでブロックを移動、クリックで行種メニューを開く、右クリックでメニューを開く');
    document.body.appendChild(handle);
    handle.addEventListener('pointerdown', _onHandlePointerDown);
    handle.addEventListener('contextmenu', _onHandleContextMenu);
    handle.addEventListener('pointerenter', _onHandlePointerEnter);
    handle.addEventListener('pointerleave', _onHandlePointerLeave);
    _handle = handle;
    return handle;
  }

  // ============================================================
  // 8. 初期化
  // ============================================================
  // 全編集ホスト（#page-content / #entity-freetext / #dp-editable）を document
  // レベルの委譲で横断的にカバーするため、ホストごとの個別バインドは不要。
  // 旧実装は #page-content にのみ pc._blockDragInit フラグでバインドしており、
  // 詳細パネル内ノート・エンティティ自由記述ではハンドル自体が出なかった。
  let _initialized = false;
  function initHandle() {
    if (_initialized) return;
    _initialized = true;
    _ensureHandle();
    document.addEventListener('mousemove', _onDocumentMouseMove);
    document.addEventListener('touchstart', _onDocumentTouchStart, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHandle, { once: true });
  } else {
    initHandle();
  }

  global.MeldexNoteBlockReorder = {
    moveBlock,
    resolveBlockAt,
    adjacentBlock,
    initHandle,
    _debug: {
      get activeDrag() { return _activeDrag; },
      get hoverTarget() { return _hoverTargetBlock; },
      get hoverEditable() { return _hoverEditable; },
    },
  };
})(window);
