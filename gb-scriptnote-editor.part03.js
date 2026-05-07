          targetIdx += dir;
        }
        if (targetIdx < 0 || targetIdx >= this.doc.rows.length) return;
        this._pushUndo('行入れ替え');
        // スワップ前にtargetのIDを保存
        const targetRowId = this.doc.rows[targetIdx].id;
        const tmp = this.doc.rows[idx];
        this.doc.rows[idx] = this.doc.rows[targetIdx];
        this.doc.rows[targetIdx] = tmp;
        this._calcCache = null;
        // DOM操作のみで行を入れ替え（_render()を避けて軽量化）
        const targetRow = this.host?.querySelector(`.sn2-row[data-row-id="${targetRowId}"]`);
        if (row && targetRow && !this._filterRoles) {
          // フィルタなし: DOM操作のみで軽量入れ替え
          if (dir === -1) row.parentNode.insertBefore(row, targetRow);
          else row.parentNode.insertBefore(row, targetRow.nextSibling);
          // ガター更新
          this._updateGuttersFrom(Math.min(idx, targetIdx));
          // ハイライトアニメーション
          row.classList.add('sn2-swap-highlight');
          setTimeout(() => row.classList.remove('sn2-swap-highlight'), 400);
        } else {
          // フィルタ有効時はDOM行数とデータ行数がずれるので全体再描画
          this._render();
        }
        this._markDirty({ skipUndo: true });
        // 移動先の行にフォーカス（_render()後はDOMが再構築されるためIDで検索）
        requestAnimationFrame(() => {
          const curRow = this.host?.querySelector(`.sn2-row[data-row-id="${rowId}"]`);
          const newText = curRow?.querySelector('.sn2-text');
          if (!newText) return;
          // フォーカスが既にnewText内にあれば再フォーカスしない（カーソル位置を保つ）
          const csel = window.getSelection();
          const inText = csel?.anchorNode && newText.contains(csel.anchorNode);
          if (!inText) this._focusText(newText, 'start');
          // DOM移動直後はlayoutが確定していないことがあるため、
          // 二重rAFで確実に layout 後にカスタムキャレットを再描画する
          if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          requestAnimationFrame(() => {
            if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          });
        });
        return;
      }

      const text = e.target.closest?.('.sn2-text');
      if (!text) return;

      if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.addRow', e)) return;
        e.preventDefault();
        const splitOffset = this._getTextOffset(text);
        this._pushUndo('行追加');
        this._splitRow(text, { keepRole: false, visibleOffset: splitOffset });
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.addRowSameType', e)) return;
        e.preventDefault();
        const splitOffset = this._getTextOffset(text);
        this._pushUndo('同タイプ行追加');
        this._splitRow(text, { keepRole: true, visibleOffset: splitOffset });
        return;
      }
      // Shift+Enter: 明示的に<br>を挿入して改行（ブラウザデフォルトに任せない）
      if (e.key === 'Enter' && e.shiftKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.newline', e)) return;
        e.preventDefault();
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        this._pushUndo('セル内改行');
        // 旧実装は dataset.before / dataset.after が設定されていると先頭・末尾での Shift+Enter を弾いていたが、
        // これらの affix は CSS の ::before / ::after 疑似要素なので <br> を挿入しても視覚順序は変わらない (常に affix の内側で改行される)。
        // ユーザー要望によりこの早期 return を撤廃し、末尾を含むあらゆる位置で改行を許可する。
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        // <br>の後にカーソルを移動
        range.setStartAfter(br);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        // <br>が末尾なら trailing <br> を追加して空行を可視化（番兵）
        // カーソルは挿入brの直後＝trailing brの直前を指すため、新しい空行に表示される
        // insertNode がテキスト末尾で分割した場合に残る空テキストノードはスキップして判定
        let needsTrailingBr = true;
        for (let n = br.nextSibling; n; n = n.nextSibling) {
          if (n.nodeType === 3 && !n.textContent) continue; // 空テキストノードは無視
          if (n.nodeType === 1 && n.tagName === 'BR') { needsTrailingBr = false; break; } // 既存の番兵
          needsTrailingBr = false; // 何か可視コンテンツあり
          break;
        }
        if (needsTrailingBr) {
          text.appendChild(document.createElement('br'));
        }
        // 高さ自動調整のためリフロートリガー
        text.style.height = 'auto';
        this._syncRowFromDom(text, { skipUndo: true });
        // スクロール追従とカスタムキャレット再描画
        requestAnimationFrame(() => {
          const r2 = sel.getRangeAt(0);
          const marker = document.createElement('span');
          r2.insertNode(marker);
          marker.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          const markerParent = marker.parentNode;
          const markerIndex = markerParent ? Array.prototype.indexOf.call(markerParent.childNodes, marker) : -1;
          marker.remove();
          if (markerParent && markerIndex >= 0) {
            const restoreRange = document.createRange();
            restoreRange.setStart(markerParent, Math.min(markerIndex, markerParent.childNodes.length));
            restoreRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(restoreRange);
          } else {
            sel.collapseToEnd();
          }
          // 末尾改行直後の空行は range.getClientRects() が 0 になりがちなので
          // 二重 rAF で layout 後に確実にカスタムキャレットを更新する
          if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          requestAnimationFrame(() => {
            if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          });
        });
        return;
      }

      // Tab: タイプ↔テキスト切り替え
      if (e.key === 'Tab') {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.tab', e)) return;
        e.preventDefault();
        const row = text.closest('.sn2-row');
        if (!row) return;
        const roleBtn = row.querySelector('.sn2-role-btn');
        if (roleBtn) this._showRoleMenu(roleBtn);
        return;
      }

      // 行間移動: 横書き=ArrowUp/Down、縦書き=ArrowLeft/Right
      // 非Shift: 2段階移動 (1) セル内で先頭/末尾へ移動 → (2) 既に境界なら隣のセルへ
      // Shift押下時: セル境界に達したら行選択を拡張、それ以外はブラウザのデフォルト
      const isVertical = this.doc.editor?.viewMode === 'vertical';
      const prevKey = isVertical ? 'ArrowRight' : 'ArrowUp';
      const nextKey = isVertical ? 'ArrowLeft' : 'ArrowDown';
      if (e.key === prevKey || e.key === nextKey) {
        const isPrev = e.key === prevKey;
        // Alt+矢印: 5 行スキップしてフォーカス移動 (フィルタ非表示はスキップ)
        if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const curRow = text.closest('.sn2-row');
          const curRowId = curRow?.dataset.rowId;
          const curIdx = this.doc.rows.findIndex(r => r.id === curRowId);
          if (curIdx < 0) return;
          const dir = isPrev ? -1 : 1;
          let remaining = 5;
          let nextIdx = curIdx;
          while (remaining > 0) {
            let probe = nextIdx + dir;
            while (probe >= 0 && probe < this.doc.rows.length) {
              const rr = this.doc.rows[probe];
              if (this._isRoleVisible(rr.role || '', rr.status || '')) break;
              probe += dir;
            }
            if (probe < 0 || probe >= this.doc.rows.length) break;
            nextIdx = probe;
            remaining--;
          }
          if (nextIdx === curIdx) return;
          const nextRowEl = this.host?.querySelector(`.sn2-row[data-row-id="${this.doc.rows[nextIdx].id}"]`);
          const nextText = nextRowEl?.querySelector('.sn2-text');
          if (nextText) {
            this._focusText(nextText, isPrev ? 'end' : 'start');
            nextText.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          }
          return;
        }
        if (e.shiftKey) {
          // Shift+矢印: セル境界に達したら行選択を拡張、それ以外はブラウザのデフォルトに任せる
          const sel = window.getSelection();
          if (!sel?.rangeCount) return;
          // focusが属するセルを起点にする（複数セル選択時はfocusが別セルにいる）
          const focusText = sel.focusNode?.nodeType === 1
            ? sel.focusNode.closest?.('.sn2-text') || text
            : sel.focusNode?.parentElement?.closest?.('.sn2-text') || text;
          if (!this._isAtBoundary(focusText, isPrev, true)) return;
          e.preventDefault();
          const curRow = focusText.closest('.sn2-row');
          if (!curRow) return;
          const curRowId = curRow.dataset.rowId;
          const curIdx = this.doc.rows.findIndex(r => r.id === curRowId);
          if (curIdx < 0) return;
          if (!this._rowSelection) this._rowSelection = new Set();
          // アンカー検証: _lastSelectedIdx が現在の選択に含まれていなければ curRow を新アンカーにする
          const lastRow = this._lastSelectedIdx >= 0 ? this.doc.rows[this._lastSelectedIdx] : null;
          let anchorIdx;
          if (lastRow && this._rowSelection.has(lastRow.id)) {
            anchorIdx = this._lastSelectedIdx;
          } else {
            this._rowSelection.clear();
            this._rowSelection.add(curRowId);
            this._lastSelectedIdx = curIdx;
            anchorIdx = curIdx;
          }
          // 次の行を探す（フィルタ非表示はスキップ）
          const dir = isPrev ? -1 : 1;
          let nextIdx = curIdx + dir;
          while (nextIdx >= 0 && nextIdx < this.doc.rows.length) {
            const rr = this.doc.rows[nextIdx];
            if (this._isRoleVisible(rr.role || '', rr.status || '')) break;
            nextIdx += dir;
          }
          if (nextIdx < 0 || nextIdx >= this.doc.rows.length) return;
          // アンカー〜nextIdx の範囲で選択を再構築
          this._rowSelection.clear();
          const fromI = Math.min(anchorIdx, nextIdx);
          const toI = Math.max(anchorIdx, nextIdx);
          for (let i = fromI; i <= toI; i++) {
            const rr = this.doc.rows[i];
            if (!rr) continue;
            if (!this._isRoleVisible(rr.role || '', rr.status || '')) continue;
            this._rowSelection.add(rr.id);
          }
          this._updateRowSelectionUI();
          // 次の行のテキストにフォーカス移動（境界端に置く）
          const nextRowEl = this.host?.querySelector(`.sn2-row[data-row-id="${this.doc.rows[nextIdx].id}"]`);
          const nextText = nextRowEl?.querySelector('.sn2-text');
          if (nextText) {
            this._focusText(nextText, isPrev ? 'end' : 'start');
            nextText.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          }
          return;
        }
        // 非Shift: 視覚的境界行 + 絶対先頭/末尾の判定で 3 段階に分岐
        // (1) 境界行でない (複数行セルの中間行): ブラウザのデフォルト (1 行移動)
        // (2) 境界行 + 絶対先頭/末尾でない: セルの先頭/末尾へジャンプ
        // (3) 境界行 + 絶対先頭/末尾: 隣のセルへ移動
        if (!this._isAtBoundary(text, isPrev)) {
          // 境界行でない: ブラウザに任せる (preventDefault しない)
          return;
        }
        // 境界行内: 絶対先頭/末尾チェック
        // _focusText が range を (textNode, 0) に設定するため、container が
        // element の場合と text node の場合で compareBoundaryPoints が
        // equal を返さない。ここでは (text, 0) から現在位置まで (または
        // 現在位置から text の末端まで) の実テキスト長で判定する。
        const csel = window.getSelection();
        if (!csel?.rangeCount) return;
        const crange = csel.getRangeAt(0);
        let atAbsoluteEdge;
        try {
          const logicalLen = typeof this._logicalTextLenWithBr === 'function'
            ? this._logicalTextLenWithBr(text)
            : this._textLenWithBr(text);
          const caretOffset = this._getTextOffset(text);
          if (caretOffset >= 0) {
            atAbsoluteEdge = isPrev ? caretOffset <= 0 : caretOffset >= logicalLen;
          } else if (isPrev) {
            const ref = document.createRange();
            ref.setStart(text, 0);
            ref.setEnd(crange.startContainer, crange.startOffset);
            atAbsoluteEdge = ref.toString().length === 0;
          } else {
            const ref = document.createRange();
            ref.selectNodeContents(text);
            ref.setStart(crange.endContainer, crange.endOffset);
            atAbsoluteEdge = ref.toString().length === 0;
          }
        } catch (err) { atAbsoluteEdge = false; }
        e.preventDefault();
        if (!atAbsoluteEdge) {
          // 境界行内だが先頭/末尾でない: セルの絶対先頭/末尾へジャンプ
          this._focusText(text, isPrev ? 'start' : 'end');
          return;
        }
        // 既に絶対先頭/末尾: 隣のセルへ移動
        const row = text.closest('.sn2-row');
        let next = isPrev ? row?.previousElementSibling : row?.nextElementSibling;
        // nextがヘッダーや存在しない場合、段を跨いで移動
        if (!next || !next.classList.contains('sn2-row')) {
          next = this._findAdjacentRow(row, isPrev);
        }
        if (!next) return;
        const nextText = next.querySelector('.sn2-text');
        if (nextText) this._focusText(nextText, isPrev ? 'end' : 'start');
        return;
      }

      // PageUp/PageDown: 前後の段に移動（折り返しモード時）
      // 縦書き: PageUp=右の段、PageDown=左の段
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        const isPrev = e.key === 'PageUp';
        const colGroup = text.closest('.sn2-column-group');
        if (!colGroup) return; // 折り返しOFFでは段なし
        e.preventDefault();
        const adjGroup = isPrev ? colGroup.previousElementSibling : colGroup.nextElementSibling;
        if (!adjGroup || !adjGroup.classList.contains('sn2-column-group')) return;
        const caretOffset = this._getTextOffset(text);
        const currentRows = [...colGroup.querySelectorAll('.sn2-row')];
        const currentRow = text.closest('.sn2-row');
        const currentIndex = Math.max(0, currentRows.indexOf(currentRow));
        const rows = adjGroup.querySelectorAll('.sn2-row');
        const target = rows[Math.min(currentIndex, Math.max(0, rows.length - 1))];
        const targetText = target?.querySelector('.sn2-text');
        if (targetText) {
          targetText.focus();
          if (caretOffset >= 0) this._setTextOffset(targetText, Math.min(caretOffset, this._textLenWithBr(targetText)));
          else this._focusText(targetText, isPrev ? 'end' : 'start');
          targetText.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
        return;
      }

      if (e.key === 'Backspace') {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed) return;
        if ((sel.anchorNode === text && sel.anchorOffset === 0) ||
            (sel.anchorNode === text.firstChild && sel.anchorOffset === 0) ||
            (!text.textContent && !text.firstChild)) {
          e.preventDefault();
          this._pushUndo('行結合');
          this._mergeWithPrev(text);
          return;
        }
      }

      if (e.key === 'Delete' && !e.shiftKey) {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed) return;
        // sel.anchorNode は null / 空テキストノードの末尾など NPE を起こしうるので null チェックを先に入れる
        const anchor = sel.anchorNode;
        const atEnd = (!text.textContent)
          || (!anchor)
          || (anchor === text && sel.anchorOffset >= text.childNodes.length)
          || (anchor.nodeType === 3 && sel.anchorOffset >= (anchor.length || 0) && !anchor.nextSibling);
        if (atEnd) {
          e.preventDefault();
          // セル末尾の改行 (\n / <br>) があればまずそれを削除する。
          // これがないと、text-after ("」" 等) が改行の後ろに描画されて
          // ユーザーから「Delete が効かない」ように見える。
          if (this._hasTrailingLineBreak(text)) {
            this._pushUndo('改行削除');
            this._removeTrailingLineBreak(text);
            this._syncRowFromDom(text);
            this._focusText(text, 'end');
            return;
          }
          this._pushUndo('行結合');
          this._mergeWithNext(text);
          return;
        }
      }

      // Shift+Delete: 現在行を削除
      if (e.key === 'Delete' && e.shiftKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.deleteRow', e)) return;
        e.preventDefault();
        const row = text.closest('.sn2-row');
        if (!row) return;
        const rowId = row.dataset.rowId;
        const idx = this.doc.rows.findIndex(r => r.id === rowId);
        if (idx < 0) return;
        // 最後の1行は削除しない
        if (this.doc.rows.length <= 1) return;
        this._pushUndo('行削除');
        this.doc.rows.splice(idx, 1);
        this._calcCache = null;
        // 隣の行にフォーカス
        const focusIdx = Math.min(idx, this.doc.rows.length - 1);
        const focusId = this.doc.rows[focusIdx].id;
        this._render();
        this._markDirty({ skipUndo: true });
        const focusDeletedNeighbor = () => {
          const nextEl = this.host?.querySelector(`.sn2-row[data-row-id="${focusId}"] .sn2-text`);
          if (nextEl) {
            this._focusText(nextEl, 'start');
            document.dispatchEvent(new Event('selectionchange'));
            if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          }
        };
        focusDeletedNeighbor();
        requestAnimationFrame(focusDeletedNeighbor);
        return;
      }
    });

    // Ctrl+Shift+V: keydownでフラグを立て、pasteハンドラでセル内ペーストに切り替える
    this._pasteInCellFlag = false;
    host.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        this._pasteInCellFlag = true;
        // pasteイベントが発火しなかった場合のフォールバックリセット
        setTimeout(() => { this._pasteInCellFlag = false; }, 200);
      }
    }, true); // captureフェーズで先に処理

    // pasteハンドラ: 改行で行を分割（空白行はタイプなし空行として追加）
    // Ctrl+Shift+V: セル内改行として貼り付け（行分割しない）
    host.addEventListener('paste', (e) => {
      const textEl = e.target.closest?.('.sn2-text');
      if (!textEl) return;
      e.preventDefault();
      const plain = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
      if (!plain) return;
      // Ctrl+Shift+V（フラグ）または単一行: セル内にそのまま挿入
      const pasteInCell = !!this._pasteInCellFlag;
      this._pasteInCellFlag = false;
      const lines = plain.split('\n');
      if (pasteInCell || lines.length <= 1) {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        this._pushUndo(pasteInCell ? 'セル内貼り付け' : '貼り付け');
        range.deleteContents();
        range.insertNode(document.createTextNode(plain));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        this._syncRowFromDom(textEl, { skipUndo: true });
        return;
      }
      // 複数行: 現在行にカーソル前後のテキストを分割し、残りの行を新規追加
      this._pushUndo('複数行ペースト');
      const pasteSel = window.getSelection();
      if (pasteSel?.rangeCount && !pasteSel.isCollapsed) {
        const range = pasteSel.getRangeAt(0);
        const selectionInsideCell = textEl.contains(range.startContainer) && textEl.contains(range.endContainer);
        if (selectionInsideCell) {
          range.deleteContents();
          range.collapse(false);
          pasteSel.removeAllRanges();
          pasteSel.addRange(range);
        }
      }
      this._syncRowFromDom(textEl, { skipUndo: true });
      const pasteCaretOffset = this._getTextOffset(textEl);
      const rowId = textEl.dataset.rowId;
      const idx = this.doc.rows.findIndex(r => r.id === rowId);
      if (idx < 0) return;
      const currentRow = this.doc.rows[idx];
      const sel = window.getSelection();
      let visibleOffset = _sn2StripRubyToPlain(currentRow.text).length;
      if (pasteCaretOffset >= 0) {
        visibleOffset = pasteCaretOffset;
      } else if (sel?.isCollapsed && sel.rangeCount) {
        const pos = this._getTextOffset(textEl);
        if (pos >= 0) visibleOffset = pos;
      }
      const [beforeText, afterText] = _sn2SplitRawTextByVisibleOffset(currentRow.text, visibleOffset);
      const escapedLines = lines.map(line => _sn2EscapeRubyText(line));
      // 最初の行は現在行に追加
      currentRow.text = beforeText + escapedLines[0];
      let newStatus = currentRow.status || '';
      if (this._filterStatuses && this._filterStatuses.size === 1) {
        newStatus = [...this._filterStatuses][0];
      }
      // 中間行と最終行を新規行として挿入
      const newRows = [];
      for (let i = 1; i < lines.length; i++) {
        const isLast = i === lines.length - 1;
        const lineText = isLast ? escapedLines[i] + afterText : escapedLines[i];
        newRows.push({
          id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: lineText ? currentRow.role : '', // 空白行はタイプなし
          status: newStatus,
          text: lineText,
          columns: {},
        });
      }
      this.doc.rows.splice(idx + 1, 0, ...newRows);
      this._calcCache = null;
      this._render();
      this._markDirty({ skipUndo: true });
      // 最後に追加した行にフォーカス
      const focusLastPastedRow = () => {
        const lastRow = newRows[newRows.length - 1];
        const lastEl = this.host?.querySelector(`.sn2-row[data-row-id="${lastRow.id}"]`);
        const lastText = lastEl?.querySelector('.sn2-text');
        if (lastText) {
          this._focusText(lastText, 'end');
          document.dispatchEvent(new Event('selectionchange'));
          if (this._caretSelChangeHandler) this._caretSelChangeHandler();
        }
      };
      focusLastPastedRow();
      requestAnimationFrame(focusLastPastedRow);
    });

    host.addEventListener('click', (e) => {
      // 自動リンククリック
      const autoLink = e.target.closest?.('.auto-link');
      if (autoLink) {
        const isEditingLink = typeof this._isEditingAutoLinkTarget === 'function'
          ? this._isEditingAutoLinkTarget(autoLink)
          : false;
        if (!isEditingLink && typeof onAutoLinkClick === 'function') {
          e.preventDefault();
          onAutoLinkClick(autoLink, e);
        }
        return;
      }
      const roleBtn = e.target.closest?.('.sn2-role-btn');
      if (roleBtn) { e.preventDefault(); this._showRoleMenu(roleBtn); return; }
      // ハンドルクリック時はD&Dのみ（クリックは何もしない）
    });

    // テキスト列の右クリックメニュー（＋長押しでも同メニュー）
    const _onScriptnoteTextCtx = (e) => {
      const textEl = e.target.closest?.('.sn2-text');
      if (!textEl) return;
      e.preventDefault();
      // 既存ポップアップを閉じる
      document.querySelectorAll('.sn2-context-menu, .sn2-header-popup').forEach(el => el.remove());
      const sel = window.getSelection();
      const hasSelection = sel && !sel.isCollapsed && sel.rangeCount > 0;
      // 選択範囲を保存（メニュー操作で選択が失われる対策）
      const savedRange = hasSelection ? sel.getRangeAt(0).cloneRange() : null;
      const savedText = hasSelection ? sel.toString().trim() : '';
      const commentAnchorEl = {
        getBoundingClientRect: () => {
          const x = Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : textEl.getBoundingClientRect().left;
          const y = Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : textEl.getBoundingClientRect().top;
          return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
        },
      };
      const menu = document.createElement('div');
      menu.className = 'sn2-context-menu sn2-header-popup';
      const mkItem = (label, action, enabled = true) => {
        const btn = document.createElement('button');
        btn.className = 'sn2-header-popup-item';
        btn.textContent = label;
        btn.disabled = !enabled;
        if (!enabled) btn.style.opacity = '0.4';
        btn.addEventListener('click', () => {
          menu.remove();
          // 選択範囲を復元してからアクションを実行
          if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
          action();
        });
        return btn;
      };
      menu.appendChild(mkItem('💬 コメントを追加', () => {
        if (typeof addCommentHere !== 'function') return;
        let override = null;
        try {
          if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.detectCommentContext === 'function') {
            override = CommentBadges.detectCommentContext(textEl);
          }
        } catch (_) { override = null; }
        if (!override || override.targetKind === 'none') {
          const row = textEl.closest?.('.sn2-row[data-row-id]');
          const rowId = row?.dataset?.rowId || '';
          const filePath = this._path || this.doc?.source?.path || '';
          if (rowId && filePath) {
            override = {
              targetKind: 'scriptnote_line',
              filePath,
              targetRef: { file: filePath, lineId: rowId },
              snapshot: (textEl.textContent || '').trim().slice(0, 120),
            };
          }
        }
        addCommentHere(override || undefined, { anchorEl: commentAnchorEl });
      }));
      menu.appendChild(mkItem('コメント一覧を開く', () => {
        const filePath = this._path || this.doc?.source?.path || '';
        if (filePath && typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
          CommentBadges.openPanelForFileComments(filePath);
        }
      }));
      menu.appendChild(mkItem('ルビ設定…', () => this._insertRuby(), hasSelection));
      menu.appendChild(mkItem('リンクを挿入...', () => {
        if (typeof showLinkInsertModal === 'function') {
          showLinkInsertModal(savedRange, (result) => {
            if (!textEl.isConnected) return;
            if (typeof this._insertLinkResultIntoText === 'function') { this._insertLinkResultIntoText(textEl, savedRange, result); return; }
            const s = window.getSelection();
            if (result.type === 'file') {
              // savedRange を復元してファイル名を挿入
              if (savedRange) { s.removeAllRanges(); s.addRange(savedRange); }
              this._pushUndo('リンク挿入');
              document.execCommand('insertText', false, result.name);
              // linkDict に追加
              if (typeof linkDict !== 'undefined' && Array.isArray(linkDict)) {
                if (!linkDict.some(d => d.text === result.name && d.path === result.path)) {
                  linkDict.push({ text: result.name, path: result.path });
                }
              }
              this._syncRowFromDom(textEl, { skipUndo: true });
              this._applyAutoLinks(textEl);
            } else if (result.type === 'url') {
              if (savedRange) { s.removeAllRanges(); s.addRange(savedRange); }
              this._pushUndo('リンク挿入');
              document.execCommand('createLink', false, result.url);
              this._syncRowFromDom(textEl, { skipUndo: true });
            }
          });
        }
      }));
      menu.appendChild(mkItem('切り取り', () => document.execCommand('cut'), hasSelection));
      menu.appendChild(mkItem('コピー', () => document.execCommand('copy'), hasSelection));
      menu.appendChild(mkItem('貼り付け', async () => {
        try {
          const text = await navigator.clipboard.readText();
          this._pushUndo('貼り付け');
          document.execCommand('insertText', false, text);
          this._syncRowFromDom(textEl, { skipUndo: true });
        } catch { document.execCommand('paste'); }
      }));
      menu.appendChild(mkItem('セル内に貼り付け', async () => {
        try {
          const clipText = await navigator.clipboard.readText();
          if (!clipText) return;
          const s = window.getSelection();
          if (!s?.rangeCount) return;
          const r = s.getRangeAt(0);
          this._pushUndo('セル内貼り付け');
          r.deleteContents();
          r.insertNode(document.createTextNode(clipText));
          r.collapse(false);
          s.removeAllRanges();
          s.addRange(r);
          this._syncRowFromDom(textEl, { skipUndo: true });
        } catch { /* clipboard API unavailable */ }
      }));
      menu.style.cssText = 'position:fixed;z-index:10000;min-width:140px;';
      const clickRect = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
      positionPopup(menu, clickRect);
      setTimeout(() => {
        const closeCtx = (ev) => {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closeCtx); }
        };
        document.addEventListener('pointerdown', closeCtx);
      }, 0);
    };
    host.addEventListener('contextmenu', _onScriptnoteTextCtx);
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(host, _onScriptnoteTextCtx);
    }

    host.addEventListener('focusout', (e) => {
      const text = e.target.closest?.('.sn2-text');
      if (!text) return;
      requestAnimationFrame(() => {
        if (!text.isConnected || !this.host?.contains(text)) return;
        this._syncRowFromDom(text, { skipUndo: true });
        if (typeof this._endTextInputUndo === 'function') this._endTextInputUndo();
      });
    });

    // === 行ドラッグ (pointer events 版) ===
    // HTML5 drag API は仕様上ドラッグ中に wheel イベントをターゲットに届けない
    // (Notion や他モダンエディタが独自実装する理由)。pointer events で自前実装
    // すれば wheel イベントは通常通り動作する。
    // - pointerdown on .sn2-handle: 待機状態。click が動くよう preventDefault は
    //   しない
    // - pointermove: 閾値を超えたらドラッグ開始。ゴースト表示 + 挿入インジ
    //   ケーター + 端オートスクロール
    // - pointerup: ドラッグ中なら drop 実行。ドラッグしていなければ click が
    //   通るので既存の行選択トグルが動く
    let pdragPending = false;
    let pdragActive = false;
    let pdragRowIds = [];
    let pdragStartX = 0, pdragStartY = 0;
    let pdragPointerId = 0;
    let pdragGhost = null;
    let pdragAutoScrollRaf = null;
    let pdragLastClientX = 0, pdragLastClientY = 0;
    const PDRAG_THRESHOLD = 4;

    const pdragAutoScrollStep = () => {
      if (!pdragActive) { pdragAutoScrollRaf = null; return; }
      const sc = document.elementFromPoint(pdragLastClientX, pdragLastClientY)?.closest?.('.sn2-scroll');
      if (!sc || !host.contains(sc)) {
        pdragAutoScrollRaf = requestAnimationFrame(pdragAutoScrollStep);
        return;
      }
      const rect = sc.getBoundingClientRect();
      const edge = 80;
      const maxSpeed = 22;
      const speedFor = (dist) => maxSpeed * Math.min(1, Math.max(0, dist / edge));
      const isVertMode = this.doc.editor?.viewMode === 'vertical';
      const isWrap = !!this.doc.editor?.wrapMode;
      let sx = 0, sy = 0;
      if (pdragLastClientX < rect.left + edge) sx = -speedFor(rect.left + edge - pdragLastClientX);
      else if (pdragLastClientX > rect.right - edge) sx = speedFor(pdragLastClientX - (rect.right - edge));
      if (pdragLastClientY < rect.top + edge) sy = -speedFor(rect.top + edge - pdragLastClientY);
      else if (pdragLastClientY > rect.bottom - edge) sy = speedFor(pdragLastClientY - (rect.bottom - edge));
      if (isVertMode || (isWrap && !isVertMode)) {
        if (sx !== 0) sc.scrollBy({ left: sx });
        else if (sy !== 0) sc.scrollBy({ top: sy });
      } else {
        if (sy !== 0) sc.scrollBy({ top: sy });
        else if (sx !== 0) sc.scrollBy({ left: sx });
      }
      pdragAutoScrollRaf = requestAnimationFrame(pdragAutoScrollStep);
    };

    const pdragCleanup = () => {
      pdragPending = false;
      pdragActive = false;
      pdragRowIds = [];
      if (pdragGhost) { pdragGhost.remove(); pdragGhost = null; }
      if (pdragAutoScrollRaf != null) { cancelAnimationFrame(pdragAutoScrollRaf); pdragAutoScrollRaf = null; }
      host.querySelectorAll('.sn2-row').forEach(r => r.classList.remove('sn2-dragging', 'sn2-drop-above', 'sn2-drop-below'));
      try { host.releasePointerCapture(pdragPointerId); } catch {}
    };

    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const handle = e.target.closest?.('.sn2-handle');
      if (!handle) return;
      // チェックボックスクリックはドラッグ対象外
      if (e.target.closest?.('.sn2-row-check')) return;
      const row = handle.closest('.sn2-row');
      if (!row) return;
      pdragPending = true;
      pdragStartX = e.clientX;
      pdragStartY = e.clientY;
      pdragPointerId = e.pointerId;
      const startId = row.dataset.rowId;
      if (this._rowSelection?.size > 1 && this._rowSelection.has(startId)) {
        const sel = this._rowSelection;
        pdragRowIds = this.doc.rows.filter(r => sel.has(r.id)).map(r => r.id);
      } else {
        pdragRowIds = [startId];
      }
      // preventDefault はしない — click が通って _toggleRowSelection が動くように
    });

    host.addEventListener('pointermove', (e) => {
      if (pdragPending && !pdragActive) {
        if (e.pointerId !== pdragPointerId) return;
        const dx = e.clientX - pdragStartX;
        const dy = e.clientY - pdragStartY;
        if (Math.abs(dx) + Math.abs(dy) < PDRAG_THRESHOLD) return;
        // ドラッグ開始
        pdragActive = true;
        try { host.setPointerCapture(pdragPointerId); } catch {}
        const idSet = new Set(pdragRowIds);
        host.querySelectorAll('.sn2-row').forEach(r => {
          if (idSet.has(r.dataset.rowId)) r.classList.add('sn2-dragging');
        });
        // ゴースト表示
        pdragGhost = document.createElement('div');
        pdragGhost.className = 'sn2-pdrag-ghost';
        pdragGhost.textContent = pdragRowIds.length > 1 ? `${pdragRowIds.length} 行を移動` : '行を移動';
        pdragGhost.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;background:var(--accent, #4a90d9);color:white;padding:4px 10px;border-radius:4px;font-size:12px;opacity:0.9;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        document.body.appendChild(pdragGhost);
      }
      if (!pdragActive) return;
      e.preventDefault();
      pdragLastClientX = e.clientX;
      pdragLastClientY = e.clientY;
      // ゴースト位置更新
      if (pdragGhost) {
        pdragGhost.style.left = (e.clientX + 12) + 'px';
        pdragGhost.style.top = (e.clientY + 12) + 'px';
      }
      // ドロップインジケーター更新
      host.querySelectorAll('.sn2-row').forEach(r => r.classList.remove('sn2-drop-above', 'sn2-drop-below'));
      const overEl = document.elementFromPoint(e.clientX, e.clientY);
      const overRow = overEl?.closest?.('.sn2-row');
      if (overRow && host.contains(overRow) && !pdragRowIds.includes(overRow.dataset.rowId)) {
        const rect = overRow.getBoundingClientRect();
        const isVertMode = this.doc.editor?.viewMode === 'vertical';
        if (isVertMode) {
          // 縦書き: 左右で判定 (画面右側 = 手前 = above)
          overRow.classList.add(e.clientX > rect.left + rect.width / 2 ? 'sn2-drop-above' : 'sn2-drop-below');
        } else {
          overRow.classList.add(e.clientY < rect.top + rect.height / 2 ? 'sn2-drop-above' : 'sn2-drop-below');
        }
      }
      // 端オートスクロールを起動 (初回のみ)
      if (pdragAutoScrollRaf == null) {
        pdragAutoScrollRaf = requestAnimationFrame(pdragAutoScrollStep);
      }
    });

    host.addEventListener('pointerup', (e) => {
      if (!pdragActive) {
        // ドラッグ未開始 (通常クリック): cleanup のみ
        pdragPending = false;
        pdragRowIds = [];
        return;
      }
      if (e.pointerId !== pdragPointerId) return;
      // ドロップ実行
      const overEl = document.elementFromPoint(e.clientX, e.clientY);
      const targetRow = overEl?.closest?.('.sn2-row');
      if (targetRow && host.contains(targetRow) && !pdragRowIds.includes(targetRow.dataset.rowId)) {
        const targetId = targetRow.dataset.rowId;
        const rect = targetRow.getBoundingClientRect();
        const isVertMode = this.doc.editor?.viewMode === 'vertical';
        const insertAfter = isVertMode
          ? e.clientX < rect.left + rect.width / 2
          : e.clientY >= rect.top + rect.height / 2;
        this._pushUndo(pdragRowIds.length > 1 ? '行移動（複数）' : '行移動');
        const draggedSet = new Set(pdragRowIds);
        const moved = pdragRowIds.map(id => this.doc.rows.find(r => r.id === id)).filter(Boolean);
        for (let i = this.doc.rows.length - 1; i >= 0; i--) {
          if (draggedSet.has(this.doc.rows[i].id)) this.doc.rows.splice(i, 1);
        }
        let insertAt = this.doc.rows.findIndex(r => r.id === targetId);
        if (insertAt < 0) insertAt = this.doc.rows.length;
        else if (insertAfter) insertAt++;
        this.doc.rows.splice(insertAt, 0, ...moved);
        this._calcCache = null;
        this._render();
        this._markDirty();
      }
      pdragCleanup();
      // ドラッグ完了後の click をキャンセル (行選択トグルが誤発火するのを防ぐ)
      const suppressClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); document.removeEventListener('click', suppressClick, true); };
      document.addEventListener('click', suppressClick, true);
      // 保険: click が発火しなかった場合に備えて次フレームで解除
      setTimeout(() => document.removeEventListener('click', suppressClick, true), 50);
    });
    host.addEventListener('pointercancel', () => { if (pdragActive || pdragPending) pdragCleanup(); });
  }

  // 段を跨いで隣接する行を取得（折り返しモードでcolumn-groupを越える）
  _findAdjacentRow(currentRow, isPrev) {
    const colGroup = currentRow.closest('.sn2-column-group');
    if (!colGroup) return null;
    const adjGroup = isPrev ? colGroup.previousElementSibling : colGroup.nextElementSibling;
    if (!adjGroup || !adjGroup.classList.contains('sn2-column-group')) return null;
    const rows = adjGroup.querySelectorAll('.sn2-row');
    if (!rows.length) return null;
    return isPrev ? rows[rows.length - 1] : rows[0];
  }

  _isAtBoundary(textEl, isPrev, allowSelection) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    if (!sel.isCollapsed && !allowSelection) return false;
    // テキスト先頭/末尾のプレーンテキスト判定（rectが取れない場合のフォールバック）
    // 選択中はfocusNode/focusOffsetで判定（anchorは選択の開始点なので移動先ではない）
    const useNode = allowSelection && !sel.isCollapsed ? sel.focusNode : sel.anchorNode;
    const useOff = allowSelection && !sel.isCollapsed ? sel.focusOffset : sel.anchorOffset;
    const isAtTextStart = () => {
      if (useNode === textEl && useOff === 0) return true;
      if (useNode === textEl.firstChild && useOff === 0) return true;
      let first = textEl.firstChild;
      while (first && first.nodeType === 1) first = first.firstChild;
      return first && useNode === first && useOff === 0;
    };
    const isAtTextEnd = () => {
      if (useNode === textEl && useOff >= textEl.childNodes.length) return true;
      if (useNode.nodeType === 3 && useOff >= useNode.length && !useNode.nextSibling) return true;
      let last = textEl.lastChild;
      while (last && last.nodeType === 1) last = last.lastChild;
      return last && useNode === last && useOff >= last.length;
    };
    const logicalOffset = this._getTextOffset(textEl);
    if (logicalOffset >= 0) {
      const logicalLen = typeof this._logicalTextLenWithBr === 'function'
        ? this._logicalTextLenWithBr(textEl)
        : this._textLenWithBr(textEl);
      if (isPrev && logicalOffset <= 0) return true;
      if (!isPrev && logicalOffset >= logicalLen) return true;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const elRect = textEl.getBoundingClientRect();
    const cs = getComputedStyle(textEl);
    const isVertical = this.doc.editor?.viewMode === 'vertical';

    if (isVertical) {
      if (elRect.width <= 0) return true;
      const padRight = parseFloat(cs.paddingRight) || 0;
      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
      const contentWidth = elRect.width - padRight - padLeft;
      if (contentWidth <= lh * 1.5) return true;
      // rect が取れない場合はテキスト先頭/末尾で判定
      if (rect.width <= 0 && rect.height <= 0) return isPrev ? isAtTextStart() : isAtTextEnd();
      if (isPrev) return rect.right > elRect.right - padRight - lh;
      return rect.left < elRect.left + padLeft + lh;
    }
    // 横書き
    if (elRect.height <= 0) return true;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBot = parseFloat(cs.paddingBottom) || 0;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
    const contentHeight = elRect.height - padTop - padBot;
    if (contentHeight <= lh * 1.5) return true;
    // rect が取れない場合はテキスト先頭/末尾で判定
    if (rect.width <= 0 && rect.height <= 0) return isPrev ? isAtTextStart() : isAtTextEnd();
    if (isPrev) return rect.top < elRect.top + padTop + lh;
    return rect.bottom > elRect.bottom - padBot - lh;
  }

  _focusText(textEl, place = 'start') {
    textEl.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    // Chromium の range.getClientRects() は (element, 0) のような要素基準の
    // 位置だとテキストノード基準と異なる rect を返すことがあり、CSS zoom 時に
    // カスタムキャレットの位置がずれる。テキストノードが存在する場合はそれを
    // 基準にして、ネイティブのキャレット測定と同じパスを踏ませる。
    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
    let targetNode = null;
    let targetOffset = 0;
    if (place === 'start') {
      targetNode = walker.nextNode();
