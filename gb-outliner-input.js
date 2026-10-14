/**
 * gb-outliner-input.js
 *
 * フォルダツリーのポインタ入力を「明示コントロール」「項目行」「ツリー空白」に分類する
 * 共通の入力判定モジュール。矩形選択（空白からのみ開始）と項目ドラッグ（項目行から開始）を
 * 判定の入口で分離するために、両方から参照する単一の情報源にする。
 *
 * 計画: app/docs/folder-tree-thumbnail-large-branch-interaction-plan-2026-07-31.md
 *       §2.5（矩形選択と項目ドラッグ）、§4.1-2（入力判定）
 * 実装: フォルダツリー改修 Phase 2（空白矩形選択と項目ドラッグ移動の分離）
 *
 * 契約（§2.5 確定仕様）:
 * - 押下位置が .tree-node-row（サムネイル・アイコン・ラベル・展開矢印・項目行内の空き幅を含む）、
 *   最近使った項目／お気に入り（.fav-item）、セクション見出し、ボタン、入力欄のいずれかに
 *   属する場合は矩形選択を絶対に開始しない。
 * - .tree-node-row 自身またはその内側は常に 'row' を返す。項目のドラッグはネイティブHTML5
 *   ドラッグ（row.draggable）に判定を委ねるため、本モジュールはここに割り込まない
 *   （candidateRow による draggable 一時無効化のような暫定状態は持たない）。
 * - 上記いずれにも属さないが、ツリーの表示範囲（#outliner-tree, #body-home, #body-workspaces
 *   および対応するサイドバーセクション）の内側であれば 'blank'（矩形選択の待機対象）を返す。
 * - ツリー表示範囲の外側は 'outside' を返す。
 *
 * 依存: なし（DOM標準APIのみ）。読み込み順に依存しないよう window.GBOutlinerInput として公開する。
 */
(function () {
  'use strict';

  // 明示コントロール: トグル矢印・ホバーボタン・最近使った項目/お気に入り・セクション見出し・
  // ボタン・入力欄。これらの上から矩形選択を開始しない（従来の _outlinerLassoBlockedTarget と同義）。
  var CONTROL_SELECTOR = '.tree-hover-btn, .tree-toggle, .sidebar-section-header, .fav-item, input, textarea, button, select, [contenteditable="true"]';

  // 項目行。サムネイル・アイコン・ラベル・行内の空き幅もすべてこの内側に含まれる。
  var ROW_SELECTOR = '.tree-node-row';

  var TREE_SCOPE_SELECTOR = '#outliner-tree, #body-home, #body-workspaces';

  function _isInTreeScope(target) {
    if (target && typeof target.closest === 'function' && target.closest(TREE_SCOPE_SELECTOR)) return true;
    var section = target && typeof target.closest === 'function' ? target.closest('.sidebar-section') : null;
    if (!section) return false;
    return section.id === 'section-workspaces' || section.id === 'section-roots' || section.id === 'section-home';
  }

  // ポインタ押下位置を分類する。'control' | 'row' | 'blank' | 'outside' のいずれかを返す。
  // 判定順序が重要: コントロール判定を最優先し（.tree-toggle は .tree-node-row の内側にも
  // あるため）、次に項目行、最後にツリー空白の順で評価する。
  function classifyPointerTarget(target) {
    if (!target || typeof target.closest !== 'function') return 'outside';
    if (target.closest(CONTROL_SELECTOR)) return 'control';
    if (target.closest(ROW_SELECTOR)) return 'row';
    if (_isInTreeScope(target)) return 'blank';
    return 'outside';
  }

  // 矩形選択を待機状態にしてよい位置かどうか（= 'blank' のときだけ true）。
  function isBlankTarget(target) {
    return classifyPointerTarget(target) === 'blank';
  }

  // 項目行（ネイティブHTML5ドラッグに判定を委ねるべき位置）かどうか。
  function isRowTarget(target) {
    return classifyPointerTarget(target) === 'row';
  }

  window.GBOutlinerInput = {
    CONTROL_SELECTOR: CONTROL_SELECTOR,
    ROW_SELECTOR: ROW_SELECTOR,
    TREE_SCOPE_SELECTOR: TREE_SCOPE_SELECTOR,
    classifyPointerTarget: classifyPointerTarget,
    isBlankTarget: isBlankTarget,
    isRowTarget: isRowTarget,
  };
})();
