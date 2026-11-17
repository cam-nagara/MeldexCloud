/* gb-note-enhance.part04.js: Markdown の行頭入力ショートカット（part02 が1000行を超えたため分割） */

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
