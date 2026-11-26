/* gb-note-enhance.part04.js: ノートの表の操作の初期化・セルのメニューの結び付けと、Markdown の行頭入力ショートカット（part02 が1000行を超えたため分割。part02 の直後に続けて読み込む） */

function _initTableOperations() {
  _ensureTableRowDragHandle();
  document.addEventListener('pointermove', (e) => {
    if (_noteTableResizeState) {
      _noteTableResizeMove(e);
      return;
    }
    _noteTableSetResizeHover(_noteTableCellAtResizeEdge(e));
  });
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    _noteTableStartResize(e);
  }, true);
  document.addEventListener('pointerup', _noteTableFinishResize, true);
  document.addEventListener('pointercancel', _noteTableFinishResize, true);
  document.addEventListener('click', (e) => {
    const cell = _noteTableCellFromTarget(e.target);
    if (cell) _showNoteTableCellControls(cell);
  });

  // セルクリックで直接編集
  document.addEventListener('click', (e) => {
    const cell = e.target.closest('td, th');
    if (!cell || !cell.closest('#page-content table, #entity-freetext table')) return;
    if (cell.closest('[contenteditable="true"]')) return; // contentEditable内テーブルは gb-editor.js に委譲
    if (cell.querySelector('input.cell-edit')) return;
    const editable = cell.closest('#page-content, #entity-freetext');
    if (!_noteTableCanEdit(editable)) return;

    const input = document.createElement('input');
    input.className = 'cell-edit';
    input.type = 'text';
    input.value = cell.textContent.trim();
    input.style.cssText = 'width:100%;border:none;background:transparent;color:inherit;font:inherit;padding:0;outline:none;';

    const originalText = cell.textContent;
    let cancelled = false;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('blur', () => {
      if (cancelled) return;
      cell.textContent = input.value;
      const pc = cell.closest('#page-content, #entity-freetext');
      _noteTableDispatchInput(pc);
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { cancelled = true; cell.textContent = originalText; }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        input.blur();
        const nextCell = ev.shiftKey ? cell.previousElementSibling : cell.nextElementSibling;
        if (nextCell) nextCell.click();
        else {
          const row = cell.parentElement;
          const nextRow = ev.shiftKey ? row.previousElementSibling : row.nextElementSibling;
          if (nextRow) {
            const target = ev.shiftKey ? nextRow.lastElementChild : nextRow.firstElementChild;
            if (target) target.click();
          }
        }
      }
    });
  });
}
_initTableOperations();
window.showNoteTableCellControls = _showNoteTableCellControls;

// テーブルセル右クリックで行/列削除メニュー（editable コンテナ委譲）
// 旧: document 委譲 → editable コンテナ個別登録へ移行（global-contextmenu-refactor-plan.md）
// 4-7: セル判定セレクタを closest('td, th') に簡略化。これにより #dp-editable 内テーブルも拾える。
function _tableCellCtxMenuHandler(e) {
  const editable = e.currentTarget;
  const cell = e.target.closest('td, th');
  if (!cell) return;
  const table = cell.closest('table');
  if (!table) return;
  if (!_noteTableCanEdit(editable, { silent: true })) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
  _showNoteTableCellControls(cell);
  _showNoteTableCellMenu(cell, e.clientX, e.clientY, { editable });
}

// editable コンテナにテーブルセルメニューを付ける
function bindTableCellContextMenu(el) {
  if (!el || el._tableCellCtxMenuAttached) return;
  el._tableCellCtxMenuAttached = true;
  el.addEventListener('contextmenu', _tableCellCtxMenuHandler);
  // タッチ/ペンの長押しでも同じハンドラを発火
  if (typeof addLongPressHandler === 'function') addLongPressHandler(el, _tableCellCtxMenuHandler);
}

// 静的要素に初期バインド（#dp-editable は gb-detail-panel.part02.js の _dpBindAutoSave で動的バインド）
bindTableCellContextMenu(document.getElementById('page-content'));
bindTableCellContextMenu(document.getElementById('entity-freetext'));

// ============================================================
// 行頭記法（工程6） — 「・」「数値」「h1〜h6」「既存の#〜######」+ Space
// ============================================================
// 計画書§5工程6: 共通の現在行変換（gb-note-block-types.js の
// MeldexNoteBlockTypes.convertCurrentLineTo）へ委譲する。現在行の解決境界も
// レジストリの resolveCurrentBlock を正本にし、旧実装（#page-content 直下の
// div/p/h1-6/blockquote だけを対象にした専用ロジック）は残さない。

// 行頭からキャレットまでのテキスト（改行区切りの現在行部分）を取得する。
function _noteLineTextBeforeCaret(block, range) {
  const before = range.cloneRange();
  before.setStart(block, 0);
  const text = before.toString().replace(/\u00a0/g, ' ');
  return text.slice(text.lastIndexOf('\n') + 1);
}

// 行頭記法トリガーの判定。一致しなければ null。
// - 「・」→ 箇条書き
// - 数値（1桁以上）→ 番号付きリスト（入力した数値をstartとして保持）
// - h1〜h6（大小文字問わず）→ 見出し1〜6
// - 既存の #〜###### → 見出し1〜6（維持）
function _noteLineStartTrigger(lineText) {
  const headingHash = lineText.match(/^(#{1,6})$/);
  if (headingHash) return { typeId: 'h' + headingHash[1].length };
  const headingLetter = lineText.match(/^[hH]([1-6])$/);
  if (headingLetter) return { typeId: 'h' + headingLetter[1] };
  if (lineText === '・') return { typeId: 'ul' }; // 「・」
  const ordered = lineText.match(/^(\d+)$/);
  if (ordered) return { typeId: 'ol', orderedStart: parseInt(ordered[1], 10) };
  return null;
}

function _handleNoteMarkdownShortcutKeydown(e) {
  if (e.defaultPrevented || e.isComposing) return; // IME変換中は誤発火させない（工程6必須要件）
  if (e.key !== ' ' && e.key !== 'Spacebar') return;
  if (typeof MeldexNoteBlockTypes === 'undefined') return;
  const editable = e.target?.closest?.(MeldexNoteBlockTypes.EDITABLE_SELECTOR);
  if (!editable || editable.contentEditable !== 'true') return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!editable.contains(range.startContainer)) return;
  const info = MeldexNoteBlockTypes.resolveCurrentBlock(editable, range);
  if (!info) return;
  // コード・表・コールアウト内では行頭記法を認識しない（誤変換防止。従来挙動を維持）
  if (info.kind === 'code' || info.kind === 'table' || info.kind === 'callout') return;
  const lineText = _noteLineTextBeforeCaret(info.block, range);
  const trigger = _noteLineStartTrigger(lineText);
  if (!trigger) return;

  e.preventDefault();
  const originalRange = range.cloneRange();
  MeldexNoteBlockTypes.convertCurrentLineTo(trigger.typeId, {
    editable,
    range: originalRange,
    orderedStart: trigger.orderedStart,
    // トリガー文字（"###" 等）の削除は、共通変換の undo push 直後・DOM変換の
    // 直前で実行し、「削除＋行種変換」を1回のUndoにまとめる（§5工程4-4）。
    beforeConvert(convInfo, convRange) {
      const deleteRange = convRange.cloneRange();
      deleteRange.setStart(convInfo.block, 0);
      const lineIdSpan = convInfo.block.firstElementChild?.classList?.contains('_nl-id') ? convInfo.block.firstElementChild : null;
      if (lineIdSpan) deleteRange.setStartAfter(lineIdSpan);
      deleteRange.deleteContents();
    },
  });
}

function bindNoteMarkdownShortcuts() {
  if (document._noteMarkdownShortcutAttached) return;
  document._noteMarkdownShortcutAttached = true;
  // captureフェーズの単一リスナーへ集約する（#page-content 限定だった旧実装から
  // #entity-freetext・#dp-editable へも一般化。動的生成される編集ホストにも
  // 個別バインド不要で追従する）。
  document.addEventListener('keydown', _handleNoteMarkdownShortcutKeydown, true);
}

bindNoteMarkdownShortcuts();

// スラッシュコマンドのイベントリスナー登録（キー操作は gb-note-block-menu.js が
// document capture フェーズで処理する。ここでは / の検出のみ）
document.addEventListener('input', _onSlashInput);
