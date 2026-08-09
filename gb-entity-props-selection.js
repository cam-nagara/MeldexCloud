/* gb-entity-props-selection.js — エントリ「列一覧」（.entity-props-grid-container、
   renderEntityPropsGridInto がフルページ版/フロートパネル版/モバイルドロワー共通で付与する
   クラス）内の文字選択・コピー操作を担当する。シート表示・ビュー状態計画 2026-08-04 で実装。

   - 値要素 (.cell-value) はシートセルと共有描画コード（gb-db-cell-ui.js の createValueElement /
     _setupCellValueDrag）でボードへドラッグする用途の draggable=true が付いている。
     ブラウザは `[draggable="true"]` 要素へ既定で `user-select: none` を当てる（Chromiumの
     既定スタイルシート挙動）ため、dragstart を握りつぶすだけでは文字選択そのものが
     ブラウザ側で常に不可能なままになる（Selection.toString() が常に空になる実害を確認済み）。
     そのため列一覧内では draggable 属性自体を false へ書き換えて無効化する
     （シートテーブル本体の .cell-value はそのまま draggable=true を維持し、ボードへの
     ドラッグ機能は変えない。対象は .entity-props-grid-container 配下だけ）。
   - 選択（マウスドラッグ・タッチのドラッグハンドル・Shift+矢印いずれも selectionchange で検知）
     に応じて選択範囲付近に「コピー」ポップアップを表示し、ボタンクリックまたは Ctrl/Cmd+C で
     クリップボードへコピーする。
   - 列一覧内で選択中はクリックでのインライン編集開始を1回だけ抑制する
     （キャプチャフェーズで停止するため、対象要素の click ハンドラ（startInlineEdit 等）に
     イベントが到達しない）。
   - 外側クリック・Escape・列一覧の折り畳み・再描画（DOM差し替え）でポップアップを閉じる。

   このファイルの関数はプロジェクト全体の慣習どおりグローバル関数として宣言する。 */

const ENTITY_PROPS_GRID_SELECTOR = '.entity-props-grid-container';

function _epsClosestGrid(node) {
  if (!node) return null;
  const el = node.nodeType === 3 ? node.parentElement : node;
  return el && typeof el.closest === 'function' ? el.closest(ENTITY_PROPS_GRID_SELECTOR) : null;
}

// 列一覧内の .cell-value から draggable 属性を外す（ボードへのドラッグ機能は列一覧では使わない）。
// 属性そのものを外すことが本質的に重要: ブラウザの既定スタイルシートは
// `[draggable="true"]` へ `user-select: none` を当てるため、dragstart を preventDefault する
// だけでは選択（Selection API）が機能しないままになる。
function _epsNeutralizeDraggableIn(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.cell-value[draggable="true"]').forEach(el => { el.draggable = false; });
}

function _epsNeutralizeAllGrids() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(ENTITY_PROPS_GRID_SELECTOR).forEach(_epsNeutralizeDraggableIn);
}

// 値要素のネイティブHTML5ドラッグ（ボードへドラッグする機能。gb-db-cell-ui.js の
// _setupCellValueDrag/_ensureCellValueDragDelegate 参照）は列一覧では無効化する。
// draggable 属性の書き換え（_epsNeutralizeDraggableIn、MutationObserver経由で常時適用）が
// 本体の対策。ここでの dragstart 捕捉は、書き換えのタイミングをすり抜けた場合の保険。
function _epsInstallDragSuppression() {
  if (typeof document === 'undefined' || document.__epsDragSuppressInstalled) return;
  document.__epsDragSuppressInstalled = true;
  document.addEventListener('dragstart', (e) => {
    if (!_epsClosestGrid(e.target)) return;
    if (e.target.closest?.('.cell-value')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

// ---- コピー ポップアップ ----
let _epsPopup = null;

function _epsClosePopup() {
  if (_epsPopup) {
    _epsPopup.remove();
    _epsPopup = null;
  }
}

function _epsFallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function _epsCopyText(text) {
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => _epsFallbackCopy(text));
  }
  return Promise.resolve(_epsFallbackCopy(text));
}

function _epsShowCopyPopup(rect, text) {
  _epsClosePopup();
  if (!text || !rect) return;
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu entity-props-selection-copy-popup';
  popup.dataset.e2eId = 'entity-props-selection-copy-popup';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'entity-props-selection-copy-btn';
  btn.dataset.e2eId = 'entity-props-selection-copy-button';
  btn.innerHTML = (typeof lucide === 'function' ? lucide('copy', 13) + ' ' : '') + 'コピー';
  // ボタン押下自体が選択を消してしまわないよう、mousedown/pointerdown の既定動作を止める
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await _epsCopyText(text);
    if (typeof showStatus === 'function') showStatus(ok ? 'コピーしました' : 'コピーに失敗しました', !ok);
    _epsClosePopup();
    window.getSelection?.()?.removeAllRanges?.();
  });
  popup.appendChild(btn);
  document.body.appendChild(popup);
  popup.style.position = 'fixed';
  popup.style.zIndex = '10000';
  if (typeof positionPopup === 'function') {
    positionPopup(popup, rect);
  } else {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    popup.style.left = (rect.left / z) + 'px';
    popup.style.top = (rect.bottom / z + 4) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
  }
  _epsPopup = popup;
}

function _epsHandleSelectionChange() {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    _epsClosePopup();
    return;
  }
  const anchorGrid = _epsClosestGrid(sel.anchorNode);
  const focusGrid = _epsClosestGrid(sel.focusNode);
  if (!anchorGrid || anchorGrid !== focusGrid) {
    _epsClosePopup();
    return;
  }
  const text = sel.toString();
  if (!text || !text.trim()) {
    _epsClosePopup();
    return;
  }
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0)) return;
  _epsShowCopyPopup(rect, text);
}

// Ctrl/Cmd+C: 列一覧内での選択を明示的にクリップボードへコピーする
// （ブラウザ標準のコピーに任せず保険をかける。値要素の draggable 由来の挙動と競合し
// 一部環境で反応しないことがあるための対策）。
function _epsHandleCopyKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== 'c') return;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  if (!_epsClosestGrid(sel.anchorNode)) return;
  const text = sel.toString();
  if (!text || !text.trim()) return;
  _epsCopyText(text);
}

function _epsHandleEscapeKeydown(e) {
  if (e.key !== 'Escape' || !_epsPopup) return;
  _epsClosePopup();
}

// 外側クリックで閉じる（ポップアップ自身のクリックは除く）
function _epsHandleOutsidePointerdown(e) {
  if (!_epsPopup) return;
  if (_epsPopup.contains(e.target)) return;
  _epsClosePopup();
}

// 折り畳み・再描画（renderEntityPropsGridInto によるDOM差し替え）でポップアップだけが
// 残らないよう、列一覧の中身が変わったら現在の選択を再確認して閉じる。同じ監視で、
// 再描画のたびに新しく生成される .cell-value[draggable] も無効化し続ける（初回描画だけでなく
// 折り畳み解除・保存後の再描画・別エントリへの切り替え等、あらゆる再構築後に効かせるため）。
function _epsInstallGridObserver() {
  if (typeof MutationObserver !== 'function' || document.__epsGridObserverInstalled) return;
  document.__epsGridObserverInstalled = true;
  const observer = new MutationObserver(() => {
    _epsNeutralizeAllGrids();
    if (!_epsPopup) return;
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.toString().trim() || !_epsClosestGrid(sel.anchorNode)) {
      _epsClosePopup();
    }
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
}

// 列一覧内で選択中にクリックすると、既定のクリック編集開始（startInlineEdit 等）へ
// イベントが到達しないようキャプチャフェーズで止める。選択そのものはブラウザ標準の
// クリック挙動（別位置クリックでの選択解除等）に任せる。
function _epsHandleCaptureClick(e) {
  const grid = _epsClosestGrid(e.target);
  if (!grid) return;
  if (_epsPopup && _epsPopup.contains(e.target)) return;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
  if (_epsClosestGrid(sel.anchorNode) !== grid) return;
  e.stopPropagation();
  e.preventDefault();
}

function _epsInstall() {
  if (typeof document === 'undefined' || document.__epsInstalled) return;
  document.__epsInstalled = true;
  _epsInstallDragSuppression();
  _epsInstallGridObserver();
  _epsNeutralizeAllGrids();
  document.addEventListener('selectionchange', _epsHandleSelectionChange);
  document.addEventListener('keydown', _epsHandleCopyKeydown);
  document.addEventListener('keydown', _epsHandleEscapeKeydown);
  document.addEventListener('pointerdown', _epsHandleOutsidePointerdown, true);
  document.addEventListener('click', _epsHandleCaptureClick, true);
}
_epsInstall();
