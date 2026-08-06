/**
 * gb-outliner-virtual.js
 *
 * フォルダツリーの仮想スクロール計算エンジン（DOM非依存の純粋関数群）。
 * 展開中の論理ツリーを平坦化し、既知の行高から累積位置を求め、表示範囲（+オーバースキャン）と
 * 固定祖先（最大3行）を計算する。DOM操作・イベント登録は gb-outliner-virtual-render.js /
 * gb-outliner-virtual-pin.js が担当し、本モジュールは一切のDOM APIに依存しない
 * （Node単体テストからそのまま呼び出せることを前提にする）。
 *
 * 計画: app/docs/folder-tree-thumbnail-large-branch-interaction-plan-2026-07-31.md
 *       §2.3-4（仮想スクロール）、§4.1-3（仮想ツリー）、§6.1（Node単体テスト対象）
 *
 * 行の形（呼び出し側が用意する。DOM要素ではなく素のオブジェクトでよい）:
 *   {
 *     id: string,            // 安定ID（通常はファイルパス）
 *     parentId: string|null, // 親のid（ルート直下はnull）
 *     depth: number,
 *     height: number,        // px。行高が混在する場合はここに実際の値を入れる
 *     data: any,              // 呼び出し側が使う元データ（省略可）
 *   }
 *
 * 依存: なし。window.GBOutlinerVirtual として公開する。
 */
(function () {
  'use strict';

  // 既定の行高（px）。§4.1-5: 22px/50px/18px/64x44pxの変数化。
  // 実際のCSS側は --tree-row-height（gb-tools.part02.part01.css）で管理し、
  // ここではNode単体テスト等DOM非依存の文脈でも参照できるよう定数として複製する。
  var ROW_HEIGHT_COMPACT = 22; // サムネイルOFF/対象外の通常行
  var ROW_HEIGHT_THUMBNAIL = 50; // サムネイル表示行・サイズ「中」（既定）。後方互換のため残す単一値。
  var ICON_SIZE_COMPACT = 18;
  var THUMBNAIL_WIDTH = 64; // サムネイル幅・サイズ「中」（既定）
  var THUMBNAIL_HEIGHT = 44; // サムネイル高・サイズ「中」（既定）

  // サムネイルサイズ設定（小/中/大）ごとの行高・寸法。CSS側（gb-tools.part02.part01.css の
  // html.thumb-size-small / html.thumb-size-large）と値を一致させること（単一情報源はここ）。
  var ROW_HEIGHT_THUMBNAIL_BY_SIZE = { small: 40, medium: ROW_HEIGHT_THUMBNAIL, large: 72 };
  var THUMBNAIL_WIDTH_BY_SIZE = { small: 48, medium: THUMBNAIL_WIDTH, large: 96 };
  var THUMBNAIL_HEIGHT_BY_SIZE = { small: 33, medium: THUMBNAIL_HEIGHT, large: 66 };

  function _normalizeThumbnailSize(size) {
    return (size === 'small' || size === 'large') ? size : 'medium';
  }
  function rowHeightThumbnailForSize(size) {
    return ROW_HEIGHT_THUMBNAIL_BY_SIZE[_normalizeThumbnailSize(size)];
  }
  function thumbnailWidthForSize(size) {
    return THUMBNAIL_WIDTH_BY_SIZE[_normalizeThumbnailSize(size)];
  }
  function thumbnailHeightForSize(size) {
    return THUMBNAIL_HEIGHT_BY_SIZE[_normalizeThumbnailSize(size)];
  }

  var DEFAULT_OVERSCAN = 8;
  var DEFAULT_MAX_PINNED_ANCESTORS = 3;

  /**
   * 展開中のツリーを幅優先ではなく深さ優先(DFS)で平坦化する。
   * 折りたたまれたノードの子孫は結果に含めない。
   *
   * @param {Array} roots - ルート直下のノード配列（呼び出し側の任意の形状でよい）
   * @param {Object} opts
   *   getId(node): string
   *   getChildren(node): Array|null|undefined  // 未取得/非展開可なら null/undefined でよい
   *   isExpanded(node): boolean
   *   getHeight(node): number                  // 省略時は ROW_HEIGHT_COMPACT
   *   getParentIdOverride(node, parentEntry): string|null // 省略時はparentEntry.id
   * @returns {Array<{id, parentId, depth, height, data}>}
   */
  function flatten(roots, opts) {
    var options = opts || {};
    var getId = options.getId || function (n) { return n && n.id; };
    var getChildren = options.getChildren || function (n) { return n && n.children; };
    var isExpanded = options.isExpanded || function (n) { return !!(n && n.expanded); };
    var getHeight = options.getHeight || function () { return ROW_HEIGHT_COMPACT; };

    var out = [];
    function visit(node, parentId, depth) {
      if (!node) return;
      var id = getId(node);
      var entry = {
        id: id,
        parentId: parentId == null ? null : parentId,
        depth: depth,
        height: Number(getHeight(node)) || ROW_HEIGHT_COMPACT,
        data: node,
      };
      out.push(entry);
      if (isExpanded(node)) {
        var children = getChildren(node);
        if (Array.isArray(children)) {
          for (var i = 0; i < children.length; i++) {
            visit(children[i], id, depth + 1);
          }
        }
      }
    }
    (roots || []).forEach(function (root) { visit(root, null, 0); });
    return out;
  }

  /**
   * 平坦化済みリストから累積オフセット配列を作る。
   * offsets[i] = flatList[i] の上端位置、offsets[n] = 合計高さ。
   */
  function buildOffsets(flatList) {
    var list = flatList || [];
    var offsets = new Array(list.length + 1);
    offsets[0] = 0;
    for (var i = 0; i < list.length; i++) {
      var h = Number(list[i] && list[i].height);
      if (!(h > 0)) h = ROW_HEIGHT_COMPACT;
      offsets[i + 1] = offsets[i] + h;
    }
    return { offsets: offsets, totalHeight: offsets[list.length] || 0 };
  }

  /**
   * オフセット配列上で、指定位置 y を含む行のインデックスを二分探索で求める。
   * y が範囲外の場合は 0 または末尾寄りにクランプする。空リストは -1。
   */
  function indexAtOffset(offsets, y) {
    var n = (offsets ? offsets.length : 0) - 1;
    if (n <= 0) return -1;
    var value = Number(y) || 0;
    if (value <= 0) return 0;
    if (value >= offsets[n]) return n - 1;
    var lo = 0, hi = n - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= value) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /**
   * 表示範囲（[start, end) 半開区間）をオーバースキャン込みで求める。
   * @param {Object} params { offsets, scrollTop, viewportHeight, overscan }
   */
  function computeVisibleRange(params) {
    var p = params || {};
    var offsets = p.offsets || [0];
    var n = offsets.length - 1;
    if (n <= 0) return { start: 0, end: 0 };
    var scrollTop = Math.max(0, Number(p.scrollTop) || 0);
    var viewportHeight = Math.max(0, Number(p.viewportHeight) || 0);
    var overscan = Math.max(0, Number(p.overscan));
    if (!(overscan >= 0)) overscan = DEFAULT_OVERSCAN;

    var firstVisible = indexAtOffset(offsets, scrollTop);
    var lastVisible = indexAtOffset(offsets, scrollTop + viewportHeight);
    if (firstVisible < 0) firstVisible = 0;
    if (lastVisible < 0) lastVisible = n - 1;

    var start = Math.max(0, firstVisible - overscan);
    var end = Math.min(n, lastVisible + 1 + overscan);
    if (end < start) end = start;
    return { start: start, end: end };
  }

  /**
   * 矩形選択の論理Y範囲（[yStart, yEnd]）に重なる行の範囲を返す。
   * computeVisibleRange と同じ形だが、オーバースキャンを持たない（選択には余分を含めない）。
   */
  function rowsInLogicalYRange(offsets, yStart, yEnd) {
    var lo = Math.min(Number(yStart) || 0, Number(yEnd) || 0);
    var hi = Math.max(Number(yStart) || 0, Number(yEnd) || 0);
    return computeVisibleRange({ offsets: offsets, scrollTop: lo, viewportHeight: Math.max(0, hi - lo), overscan: 0 });
  }

  /**
   * flatList[topIndex] の祖先を、直近から最大 maxLevels 件たどり、
   * 表示スタック順（root寄り→直近の順）で返す。
   * 深さ4以上でも必ず3件（既定）に丸める。
   */
  function pinnedAncestors(flatList, topIndex, maxLevels) {
    var list = flatList || [];
    var limit = maxLevels > 0 ? maxLevels : DEFAULT_MAX_PINNED_ANCESTORS;
    if (topIndex == null || topIndex < 0 || topIndex >= list.length) return [];
    var byId = new Map();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id != null) byId.set(list[i].id, list[i]);
    }
    var nearestFirst = [];
    var cur = list[topIndex];
    var guard = 0;
    while (cur && cur.parentId != null && guard < 10000) {
      guard++;
      var parent = byId.get(cur.parentId);
      if (!parent) break;
      nearestFirst.push(parent);
      if (nearestFirst.length >= limit) break;
      cur = parent;
    }
    return nearestFirst.reverse();
  }

  // ------------------------------------------------------------
  // 安定ID集合ヘルパー（選択集合・ロード中集合等の薄いラッパー）
  // ------------------------------------------------------------
  function createStableIdSet(initial) {
    var set = new Set(initial || []);
    return {
      add: function (id) { if (id != null) set.add(id); },
      remove: function (id) { set.delete(id); },
      has: function (id) { return set.has(id); },
      toggle: function (id) { if (set.has(id)) set.delete(id); else set.add(id); },
      clear: function () { set.clear(); },
      values: function () { return Array.from(set); },
      get size() { return set.size; },
    };
  }

  var api = {
    ROW_HEIGHT_COMPACT: ROW_HEIGHT_COMPACT,
    ROW_HEIGHT_THUMBNAIL: ROW_HEIGHT_THUMBNAIL,
    ICON_SIZE_COMPACT: ICON_SIZE_COMPACT,
    THUMBNAIL_WIDTH: THUMBNAIL_WIDTH,
    THUMBNAIL_HEIGHT: THUMBNAIL_HEIGHT,
    ROW_HEIGHT_THUMBNAIL_BY_SIZE: ROW_HEIGHT_THUMBNAIL_BY_SIZE,
    THUMBNAIL_WIDTH_BY_SIZE: THUMBNAIL_WIDTH_BY_SIZE,
    THUMBNAIL_HEIGHT_BY_SIZE: THUMBNAIL_HEIGHT_BY_SIZE,
    rowHeightThumbnailForSize: rowHeightThumbnailForSize,
    thumbnailWidthForSize: thumbnailWidthForSize,
    thumbnailHeightForSize: thumbnailHeightForSize,
    DEFAULT_OVERSCAN: DEFAULT_OVERSCAN,
    DEFAULT_MAX_PINNED_ANCESTORS: DEFAULT_MAX_PINNED_ANCESTORS,
    flatten: flatten,
    buildOffsets: buildOffsets,
    indexAtOffset: indexAtOffset,
    computeVisibleRange: computeVisibleRange,
    rowsInLogicalYRange: rowsInLogicalYRange,
    pinnedAncestors: pinnedAncestors,
    createStableIdSet: createStableIdSet,
  };

  if (typeof window !== 'undefined') {
    window.GBOutlinerVirtual = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
