/* gb-board-card-tail.js: board card as speech-bubble tail origin */
/**
 * ボードのカードに「フキダシのしっぽ」を付ける薄い配線層。
 * 座標変換・追従ループ・端点ドラッグ・保存データの読み書きは
 * gb-annotation-tails.js の AnnotationStickyTail をそのまま使う（2つ目の実装を作らない）。
 * このファイルは「起点をカードにする」ための install オプションと、
 * メニュー（追加する／削除する）・ボードの取り消し履歴への接続だけを担当する。
 */

// リサイズハンドル・カードメニュー・リンクを開くボタンの上では
// Alt+Shift+ドラッグでのしっぽ作成を始めない（アノテート側の既定に、カード固有の要素を足したもの）。
const BD_CARD_TAIL_DRAG_EXCLUDE_SELECTOR = 'button,.ann-note-resize-handle,.gb-fmt-popup,.bd-card-menu-btn,.bd-link-open-btn,.bd-resize';

// カードのしっぽはアノテートツールバーの概念を持たないため、ハンドルのドラッグ可否は
// CSS側 (.bd-node:hover / .bd-node.bd-selected のときだけ opacity:1 + pointer-events:auto) が
// 実質的なゲートになる。JS側は常に許可してよい。
function _bdCardTailCanDragHandles() {
  return true;
}

function _bdCardTailPersist() {
  if (typeof bdDirty === 'function') bdDirty();
}

// しっぽの色は、他の装飾同様カードの実際の背景色に揃える（getComputedStyle経由でテーマ・
// CSSクラス由来の背景にも追従する。インラインstyleが無いカードでも正しい色になる）。
function _bdCardTailColor(cardEl) {
  try {
    if (cardEl && typeof getComputedStyle === 'function') {
      const bg = getComputedStyle(cardEl).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
  } catch {}
  return cardEl?.style?.background || '';
}

// 端点のドラッグ・Alt+Shift+ドラッグでの新規作成は、操作の区切りで1件だけボードの取り消し
// 履歴へ積む（pointermoveのたびに積まない）。_installDrag からドラッグ開始時に一度だけ呼ばれる。
function _bdCardTailOnDragStart() {
  if (typeof bdPushUndo === 'function') bdPushUndo('ボード: フキダシのしっぽ');
}

/**
 * カードのDOM要素へしっぽ機能を配線する。bdRenderNode() がカードを描画するたびに、
 * しっぽの有無に関わらず毎回呼ぶ（Alt+Shift+ドラッグでの新規作成を受け付けるため）。
 */
function bdInstallCardTail(cardEl, node) {
  if (!cardEl || !node) return;
  if (typeof AnnotationStickyTail === 'undefined' || typeof AnnotationStickyTail.install !== 'function') return;
  AnnotationStickyTail.install(cardEl, {
    data: node,
    persist: _bdCardTailPersist,
    getColor: () => _bdCardTailColor(cardEl),
    // カードは追従先が動いても自分は動かない（付箋と違い、勝手に動くとデータ破壊になる）。
    followTarget: false,
    // ボードには tailX/tailY を使う別概念「バルーン」が既にある。旧形式変換を無効化しないと、
    // バルーンを持つカードへ install しただけで誤ってしっぽへ変換され、保存時にバルーンの
    // データが消える。
    legacyFallback: false,
    canDragHandles: _bdCardTailCanDragHandles,
    dragExcludeSelector: BD_CARD_TAIL_DRAG_EXCLUDE_SELECTOR,
    onDragStart: _bdCardTailOnDragStart,
  });
}

function bdCardHasTail(node) {
  return !!(node && node.tail);
}

// メニュー（右クリック／「…」）からの「追加する」。Alt+Shift+ドラッグを知らなくても
// 到達できる導線として、カード中心から下向きの既定しっぽを作る（対象なし=固定点）。
function bdAddCardTail(cardEl, node) {
  if (!node || node.tail) return;
  if (typeof bdPushUndo === 'function') bdPushUndo('ボード: フキダシのしっぽを追加');
  const w = (cardEl && cardEl.offsetWidth) || node.w || 160;
  const h = (cardEl && cardEl.offsetHeight) || node.h || 60;
  const tail = { startX: w / 2, startY: h / 2, endX: w / 2, endY: h + 40, target: null };
  if (cardEl && typeof AnnotationStickyTail !== 'undefined' && typeof AnnotationStickyTail.setTail === 'function') {
    AnnotationStickyTail.setTail(cardEl, tail, _bdCardTailPersist);
  } else {
    node.tail = tail;
    _bdCardTailPersist();
  }
}

// メニューからの「削除する」。
function bdRemoveCardTail(cardEl, node) {
  if (!node || !node.tail) return;
  if (typeof bdPushUndo === 'function') bdPushUndo('ボード: フキダシのしっぽを削除');
  if (cardEl && typeof AnnotationStickyTail !== 'undefined' && typeof AnnotationStickyTail.removeTail === 'function') {
    AnnotationStickyTail.removeTail(cardEl, _bdCardTailPersist);
  } else {
    delete node.tail;
    _bdCardTailPersist();
  }
}
