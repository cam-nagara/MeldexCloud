      targetOffset = 0;
    } else {
      let last = null;
      let node;
      while ((node = walker.nextNode())) last = node;
      targetNode = last;
      targetOffset = last ? last.nodeValue.length : 0;
    }
    if (targetNode) {
      range.setStart(targetNode, targetOffset);
      range.collapse(true);
    } else {
      // 空セル: 従来通り要素を指定
      range.selectNodeContents(textEl);
      range.collapse(place === 'start');
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // === 行操作 ===

  _splitRow(textEl, opts) {
    const row = textEl.closest('.sn2-row');
    if (!row) return;
    const rowId = row.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    if (idx < 0) return;

    // ルビ対応: DOMを同期してからテキストを分割
    this._syncRowFromDom(textEl, { skipUndo: true });
    const fullText = this.doc.rows[idx].text;
    const sel = window.getSelection();
    let beforeText = fullText, afterText = '';
    const providedVisibleOffset = Number.isFinite(opts?.visibleOffset) ? opts.visibleOffset : -1;
    if (providedVisibleOffset >= 0 || (sel && sel.isCollapsed && sel.rangeCount > 0)) {
      const visibleOffset = providedVisibleOffset >= 0 ? providedVisibleOffset : this._getTextOffset(textEl);
      if (visibleOffset >= 0) {
        [beforeText, afterText] = _sn2SplitRawTextByVisibleOffset(fullText, visibleOffset);
      }
    }

    this.doc.rows[idx].text = beforeText;

    // タイプ決定: keepRole=trueなら同じタイプ、falseなら空（なし）
    // フィルタで1タイプだけ表示中ならそのタイプを使用
    let newRole = opts?.keepRole ? this.doc.rows[idx].role : '';
    if (this._filterRoles && this._filterRoles.size === 1) {
      newRole = [...this._filterRoles][0];
    }
    let newStatus = this.doc.rows[idx].status || '';
    if (this._filterStatuses && this._filterStatuses.size === 1) {
      newStatus = [...this._filterStatuses][0];
    }
    const newRow = { id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: newRole, status: newStatus, text: afterText, columns: {} };
    if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
      const roleValue = opts?.keepRole && !this._filterRoles?.size
        ? (this.doc.rows[idx].roleRef || newRole)
        : newRole;
      globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, newRow, roleValue);
    }
    this.doc.rows.splice(idx + 1, 0, newRow);
    this._calcCache = null;
    // ルビ対応: 全体再描画で正しくDOMを構築
    this._render();
    this._markDirty({ skipUndo: true });
    // 新しい行にフォーカス。E2E/高速操作では rAF だけだと次操作が先行するため即時にも反映する。
    const focusNewRow = () => {
      const newRowEl = this.host?.querySelector(`.sn2-row[data-row-id="${newRow.id}"]`);
      const newText = newRowEl?.querySelector('.sn2-text');
      if (newText) {
        this._focusText(newText, 'start');
        document.dispatchEvent(new Event('selectionchange'));
        if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      }
    };
    focusNewRow();
    requestAnimationFrame(focusNewRow);
  }

  _mergeWithPrev(textEl) {
    const row = textEl.closest('.sn2-row');
    if (!row) return;
    let prev = row.previousElementSibling;
    // 折り返しモード: 段の最初の行なら前の段の最後の行を探す
    if (!prev || !prev.classList.contains('sn2-row')) prev = this._findAdjacentRow(row, true);
    if (!prev) return;
    const prevText = prev.querySelector('.sn2-text');
    if (!prevText) return;

    const rowId = row.dataset.rowId;
    const prevId = prev.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    const prevIdx = this.doc.rows.findIndex(r => r.id === prevId);
    if (idx < 0 || prevIdx < 0) return;

    // ルビ対応: DOM同期してからテキスト結合
    this._syncRowFromDom(prevText, { skipUndo: true });
    this._syncRowFromDom(textEl, { skipUndo: true });
    const cursorPos = this.doc.rows[prevIdx].text.length;
    this.doc.rows[prevIdx].text += this.doc.rows[idx].text;
    this.doc.rows.splice(idx, 1);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    // 結合位置にカーソル
    const focusMergedRow = () => {
      const newPrevEl = this.host?.querySelector(`.sn2-row[data-row-id="${prevId}"]`);
      const newPrevText = newPrevEl?.querySelector('.sn2-text');
      if (newPrevText) this._focusTextAt(newPrevText, cursorPos);
    };
    focusMergedRow();
    requestAnimationFrame(focusMergedRow);
  }

  // セル末尾に改行 (\n / <br>) があるかを判定する (DOM 変更なし)
  _hasTrailingLineBreak(textEl) {
    if (!textEl) return false;
    let last = textEl.lastChild;
    while (last && last.nodeType === 3 && last.textContent === '') {
      last = last.previousSibling;
    }
    if (!last) return false;
    if (last.nodeType === 3 && last.textContent.endsWith('\n')) return true;
    if (last.nodeType === 1 && last.tagName === 'BR') return true;
    return false;
  }

  _isTerminalSentinelBrNode(node, root) {
    if (!node || node.nodeType !== 1 || node.tagName !== 'BR' || !root) return false;
    let next = node.nextSibling;
    while (next && next.nodeType === 3 && next.textContent === '') next = next.nextSibling;
    if (next) return false;
    let prev = node.previousSibling;
    while (prev && prev.nodeType === 3 && prev.textContent === '') prev = prev.previousSibling;
    return !!(prev && prev.nodeType === 1 && prev.tagName === 'BR' && root.contains(prev));
  }

  _logicalTextLenWithBr(textEl) {
    if (!textEl) return 0;
    const total = this._textLenWithBr(textEl);
    let last = textEl.lastChild;
    while (last && last.nodeType === 3 && last.textContent === '') last = last.previousSibling;
    return this._isTerminalSentinelBrNode(last, textEl) ? Math.max(0, total - 1) : total;
  }

  // セル末尾の末尾改行 (\n / <br>) を 1 段階ぶん削除する。
  // - 最後の text node の末尾が \n ならそれを削除
  // - 最後の子が <br> なら削除。直前も <br> (sentinel との組) なら両方削除して
  //   可視的な改行が 1 回で消えるようにする
  // 何か削除した場合は true を返す
  _removeTrailingLineBreak(textEl) {
    if (!textEl) return false;
    // 末尾の空 text node を掃除
    let last = textEl.lastChild;
    while (last && last.nodeType === 3 && last.textContent === '') {
      const prev = last.previousSibling;
      last.remove();
      last = prev;
    }
    if (!last) return false;
    // 末尾が \n で終わる text node
    if (last.nodeType === 3 && last.textContent.endsWith('\n')) {
      last.textContent = last.textContent.slice(0, -1);
      return true;
    }
    // 末尾が <br>
    if (last.nodeType === 1 && last.tagName === 'BR') {
      const prev = last.previousSibling;
      last.remove();
      // Shift+Enter は <br> (ユーザー改行) + <br> (sentinel) のペアを作るので、
      // 末尾 <br> の前も <br> ならペアとみなして両方削除する
      if (prev && prev.nodeType === 1 && prev.tagName === 'BR') {
        prev.remove();
      }
      return true;
    }
    return false;
  }

  _mergeWithNext(textEl) {
    const row = textEl.closest('.sn2-row');
    if (!row) return;
    let next = row.nextElementSibling;
    // 折り返しモード: 段の最後の行なら次の段の最初の行を探す
    if (!next || !next.classList.contains('sn2-row')) next = this._findAdjacentRow(row, false);
    if (!next) return;
    const nextText = next.querySelector('.sn2-text');
    if (!nextText) return;

    const rowId = row.dataset.rowId;
    const nextId = next.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    const nextIdx = this.doc.rows.findIndex(r => r.id === nextId);
    if (idx < 0 || nextIdx < 0) return;

    // ルビ対応: DOM同期してからテキスト結合
    this._syncRowFromDom(textEl, { skipUndo: true });
    this._syncRowFromDom(nextText, { skipUndo: true });
    const cursorPos = this.doc.rows[idx].text.length;
    this.doc.rows[idx].text += this.doc.rows[nextIdx].text;
    this.doc.rows.splice(nextIdx, 1);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    const focusMergedRow = () => {
      const newRowEl = this.host?.querySelector(`.sn2-row[data-row-id="${rowId}"]`);
      const newText = newRowEl?.querySelector('.sn2-text');
      if (newText) this._focusTextAt(newText, cursorPos);
    };
    focusMergedRow();
    requestAnimationFrame(focusMergedRow);
  }

  _focusTextAt(textEl, offset) {
    textEl.focus();
    this._setTextOffset(textEl, offset);
    document.dispatchEvent(new Event('selectionchange'));
    if (this._caretSelChangeHandler) this._caretSelChangeHandler();
  }

  _updateGuttersFrom(startIdx) {
    const calc = this._calcPagePanel();
    const cc = this.doc.editor?.countConfig || {};
    const rows = this.host.querySelectorAll('.sn2-row');
    const isVert = this.doc.editor?.viewMode === 'vertical';
    const mergeDisplay = !!this.doc.editor?.mergeDisplay;
    const clearCc = (el) => { delete el.dataset.ccBg; delete el.dataset.ccColor; delete el.dataset.ccWeight; delete el.dataset.ccSize; };
    const setCc = (el, gs) => { if (gs.bgColor) el.dataset.ccBg = gs.bgColor; if (gs.textColor) el.dataset.ccColor = gs.textColor; if (gs.fontWeight) el.dataset.ccWeight = gs.fontWeight; if (gs.fontSize) el.dataset.ccSize = gs.fontSize; };
    let prevVisibleCalc = null;
    for (const rowEl of rows) {
      const rowId = rowEl.dataset.rowId;
      const docIdx = this.doc.rows.findIndex(r => r.id === rowId);
      if (docIdx < 0) continue;
      const rowCalc = calc[docIdx];
      if (!rowCalc) continue;
      const prevCalc = prevVisibleCalc;
      if (docIdx >= startIdx) {
        // 大区切り（primary）
        const gutter = rowEl.querySelector('.sn2-gutter:not(.sn2-gutter2)');
        if (gutter) {
          const gutterText = this._formatGutterPrimary(rowCalc);
          const prevGutterText = (mergeDisplay && prevCalc) ? this._formatGutterPrimary(prevCalc) : '';
          const showGutterText = !(mergeDisplay && gutterText === prevGutterText);
          gutter.textContent = showGutterText ? gutterText : '';
          // 縦書き: 半角英数字を縦中横に再ラップ (textContent 設定で tcy span が消えるため)
          if (isVert) this._wrapTcy(gutter, 'sn2-tcy-wide');
          clearCc(gutter);
          if (showGutterText && cc.primaryStyle) setCc(gutter, cc.primaryStyle);
        }
        // 小区切り（secondary）
        const gutter2 = rowEl.querySelector('.sn2-gutter2');
        if (gutter2) {
          const gutter2Text = this._formatGutterSecondary(rowCalc);
          const prevGutter2Text = (mergeDisplay && prevCalc) ? this._formatGutterSecondary(prevCalc) : '';
          const showGutter2Text = !(mergeDisplay && gutter2Text === prevGutter2Text);
          gutter2.textContent = showGutter2Text ? gutter2Text : '';
          if (isVert) this._wrapTcy(gutter2, 'sn2-tcy-wide');
          clearCc(gutter2);
          if (showGutter2Text && cc.secondaryStyle) setCc(gutter2, cc.secondaryStyle);
        }
        // スタイル再適用
        const row = this.doc.rows[docIdx];
        if (row) this._applyRowStyle(rowEl, row.role);
      }
      prevVisibleCalc = rowCalc;
    }
  }

  // === タイプ選択メニュー → gb-scriptnote-menu.js に移動 ===

  // === DOM同期 ===

  _beginTextInputUndo(label = '編集') {
    if (!this._textInputUndoOpen) {
      this._pushUndo(label);
      this._textInputUndoOpen = true;
    }
    if (this._textInputUndoTimer) clearTimeout(this._textInputUndoTimer);
    this._textInputUndoTimer = setTimeout(() => {
      this._textInputUndoTimer = null;
      this._textInputUndoOpen = false;
    }, 1000);
  }

  _endTextInputUndo() {
    if (this._textInputUndoTimer) {
      clearTimeout(this._textInputUndoTimer);
      this._textInputUndoTimer = null;
    }
    this._textInputUndoOpen = false;
  }

  _syncRowFromDom(textEl, options = {}) {
    const rowId = textEl.dataset.rowId;
    const row = this.doc.rows.find(r => r.id === rowId);
    if (!row) return;
    // ルビスパンを {漢字|ルビ} 形式に変換（自動ルビはスキップ）。
    // プレーンテキスト部分は `\` `{` `|` `}` をエスケープして保存する（復元時に逆変換される）。
    let text = '';
    const walk = (node) => {
      if (node.nodeType === 3) { text += _sn2EscapeScriptNotePlainText(node.textContent); return; }
      if (node.nodeType === 1) {
        if (node.dataset?.manualLink && node.dataset?.path && typeof this._formatManualLinkMarkup === 'function') {
          text += this._formatManualLinkMarkup(node.textContent, node.dataset.path);
          return;
        }
        // 自動ルビ・自動リンクはテキストのみ出力（マークアップを保存しない）
        if (node.dataset?.autoRuby || node.dataset?.autoLink) { text += _sn2EscapeScriptNotePlainText(node.textContent); return; }
        if (node.dataset?.ruby) {
          text += `{${_sn2EscapeRubyText(node.textContent)}|${_sn2EscapeRubyText(node.dataset.ruby)}}`;
          return;
        }
        if (node.tagName === 'BR') {
          if (!this._isTerminalSentinelBrNode(node, textEl)) text += '\n';
          return;
        }
        node.childNodes.forEach(walk);
      }
    };
    textEl.childNodes.forEach(walk);
    text = text.replace(/\u00A0/g, ' ');
    if (row.text !== text) {
      const wasEmpty = !row.text;
      const nowEmpty = !text;
      row.text = text;
      if (wasEmpty !== nowEmpty) this._calcCache = null;
      this._markDirty(options.skipUndo ? { skipUndo: true } : {});
    }
  }

  _syncAllFromDom() {
    if (!this.host) return;
    // sync-from-dom の最中に _markDirty → _pushUndo → _syncAllFromDom の再発火ループが
    // 起きないようガードフラグで抑制する
    this._inSyncingFromDom = true;
    try {
      this.host.querySelectorAll('.sn2-text').forEach(el => this._syncRowFromDom(el));
    } finally {
      this._inSyncingFromDom = false;
    }
  }

  // B-MANGA と同じJIS系配置・隣接衝突解決をCSS座標へ反映する。
  _adjustRubySpacing() {
    if (!this.host) return;
    const model = typeof MeldexRubyPresentation !== 'undefined' ? MeldexRubyPresentation : null;
    if (!model) return;
    model.refreshRubyNodes(this);
    const presentation = model.ensureDocument(this.doc);
    const isVertical = this.doc?.editor?.viewMode === 'vertical';
    const spans = this.host.querySelectorAll('.sn2-text [data-ruby]');
    if (!spans.length) return;
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    const rows = new Map();
    const spanToInfo = new Map();
    spans.forEach((span, index) => {
      const rect = span.getBoundingClientRect();
      const parentStart = (isVertical ? rect.top : rect.left) / z;
      const parentEnd = (isVertical ? rect.bottom : rect.right) / z;
      const rubyText = span.dataset.rubyRendered || span.dataset.ruby;
      const baseEm = parseFloat(getComputedStyle(span).fontSize) || 16;
      const info = model.createRubyLayoutInfo({
        parentStart,
        parentEnd,
        baseEm,
        rubyText,
        presentation,
        style: span.dataset.rubyStyle,
      });
      info.span = span;
      info.groupId = span.dataset.rubyGroupId || `span-${index}`;
      const crossStart = (isVertical ? rect.left : rect.top) / z;
      const lineKey = Math.round(crossStart * 2) / 2;
      info._lineKey = lineKey;
      if (!rows.has(lineKey)) rows.set(lineKey, []);
      rows.get(lineKey).push(info);
      spanToInfo.set(span, info);
      const crossSize = (isVertical ? rect.width : rect.height) / z;
      span.style.setProperty('--sn2-ruby-base-edge', ((crossSize + baseEm) * 0.5) + 'px');
      span.style.marginLeft = '';
      span.style.marginTop = '';
    });
    this._appendAfterTextRubyBoundaries(rows, spanToInfo, isVertical, z);
    rows.forEach(infos => {
      model.resolveRubyOverlaps(infos).forEach(info => {
        if (!info.span) return;
        const layout = model.finalizeRubyLayout(info);
        if (!layout) return;
        const style = info.span.style;
        style.setProperty('--sn2-ruby-inline-start', layout.inlineStartPx + 'px');
        style.setProperty('--sn2-ruby-layout-extent', layout.extentPx + 'px');
        style.setProperty('--sn2-ruby-size-override', layout.fontSizePx + 'px');
        style.setProperty('--sn2-ruby-effective-letter-spacing', layout.letterSpacingPx + 'px');
        style.setProperty('--sn2-ruby-gap-px', layout.gapPx + 'px');
      });
    });
  }

  // 後の文字列（data-after）は::afterで描画され重なり解決の対象外だったため、
  // 最終文字のルビが閉じ括弧等に被る不具合があった。占有幅を「動かせない境界」
  // (span:null, minExtent===extent) として同じ行のresolveRubyOverlapsに参加させる。
  _appendAfterTextRubyBoundaries(rows, spanToInfo, isVertical, z) {
    this.host.querySelectorAll('.sn2-text[data-after]:not(:empty)').forEach(textEl => {
      const rubySpans = textEl.querySelectorAll('[data-ruby]');
      if (!rubySpans.length) return;
      const info = spanToInfo.get(rubySpans[rubySpans.length - 1]);
      if (!info || info._lineKey === undefined) return;
      const boundary = this._measureAfterTextRubyBoundary(textEl, isVertical, z);
      if (boundary) rows.get(info._lineKey)?.push(boundary);
    });
  }

  // data-after の実際の描画幅は::afterのため直接測れない。同じフォント文脈の
  // 子要素として一時的に不可視計測し、直後に取り除く（DOM変更は無し扱い）。
  _measureAfterTextRubyBoundary(textEl, isVertical, z) {
    const afterText = textEl.dataset.after || '';
    const lastChild = textEl.lastChild;
    if (!afterText || !lastChild) return null;
    // 末尾がルビ等のinline-block要素だと、その直後に collapse したRangeの矩形が
    // 0になるブラウザ実装があるため、要素なら要素自身の矩形を終端とする。
    let endRect;
    if (lastChild.nodeType === Node.TEXT_NODE) {
      const endRange = document.createRange();
      endRange.selectNodeContents(textEl);
      endRange.collapse(false);
      endRect = endRange.getBoundingClientRect();
    } else {
      endRect = lastChild.getBoundingClientRect();
    }
    const probe = document.createElement('span');
    probe.textContent = afterText;
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:-9999px;';
    textEl.appendChild(probe);
    const probeRect = probe.getBoundingClientRect();
    probe.remove();
    const afterSize = (isVertical ? probeRect.height : probeRect.width) / z;
    if (!(afterSize > 0)) return null;
    const parentStart = (isVertical ? endRect.bottom : endRect.right) / z;
    return {
      parentStart,
      parentEnd: parentStart + afterSize,
      parentSpan: afterSize,
      parentCenter: parentStart + afterSize / 2,
      baseEm: 0,
      rubyEm: 0,
      count: 0,
      text: '',
      style: '',
      align: 'start',
      extent: afterSize,
      minExtent: afterSize,
      effectiveLetterSpacing: 0,
      condense: 1,
      gapPx: 0,
      groupId: '__sn2-after-boundary__',
      span: null,
    };
  }

  // 自動ルビルールをテキスト要素に適用（表示のみ、data-auto-ruby属性で識別）
  _applyAutoRuby(textEl) {
    const rules = this.doc?.rubyRules;
    // 既存の自動ルビを除去（再適用時の二重表示を防止）
    textEl.querySelectorAll('[data-auto-ruby]').forEach(span => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    textEl.normalize();
    if (!rules || !rules.length) return;
    // 既にルビが付いているテキストを避けるため、テキストノードのみを対象にする
    const textNodes = [];
    const collectTextNodes = (node) => {
      if (node.nodeType === 3 && node.textContent) textNodes.push(node);
      else if (node.nodeType === 1 && !node.dataset?.ruby && !node.dataset?.autoRuby) {
        node.childNodes.forEach(collectTextNodes);
      }
    };
    collectTextNodes(textEl);
    for (const tNode of textNodes) {
      let content = tNode.textContent;
      let matched = false;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      // 全ルールをテキスト内で検索（先に見つかった位置優先）
      while (lastIdx < content.length) {
        let earliest = null;
        for (const rule of rules) {
          if (!rule.text || !rule.ruby) continue;
          const pos = content.indexOf(rule.text, lastIdx);
          if (pos >= 0 && (!earliest || pos < earliest.pos || (pos === earliest.pos && rule.text.length > earliest.rule.text.length))) {
            earliest = { pos, rule };
          }
        }
        if (!earliest) break;
        matched = true;
        if (earliest.pos > lastIdx) frag.appendChild(document.createTextNode(content.slice(lastIdx, earliest.pos)));
        const span = document.createElement('span');
        span.dataset.ruby = earliest.rule.ruby;
        if (['group', 'mono', 'jukugo'].includes(earliest.rule.style)) {
          span.dataset.rubyStyle = earliest.rule.style;
          span.dataset.rubyStyleSource = 'rule';
        }
        span.dataset.autoRuby = 'true';
        span.textContent = earliest.rule.text;
        frag.appendChild(span);
        lastIdx = earliest.pos + earliest.rule.text.length;
      }
      if (matched) {
        if (lastIdx < content.length) frag.appendChild(document.createTextNode(content.slice(lastIdx)));
        tNode.parentNode.replaceChild(frag, tNode);
      }
    }
  }

  // D&D: テキストセルへのファイル/ノードドロップハンドラ
  _setupTextCellDrop(textDiv) {
    textDiv.addEventListener('dragover', (e) => {
      if (MeldexDnD.isPanelDnD(e.dataTransfer.types, e.ctrlKey)) return;
      if (!e.dataTransfer.types.includes('application/x-meldex-node') &&
          !e.dataTransfer.types.includes('application/x-annotation') &&
          !e.dataTransfer.types.includes('application/x-cal-event')) return;
      e.preventDefault();
      e.stopPropagation();
      MeldexDnD.showDropCaret(textDiv, e);
    });
    textDiv.addEventListener('dragleave', (e) => {
      if (!textDiv.contains(e.relatedTarget)) MeldexDnD.hideDropCaret(textDiv);
    });
    textDiv.addEventListener('drop', (e) => {
      if (MeldexDnD.isPanelDnD(e.dataTransfer.types, e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      MeldexDnD.hideDropCaret(textDiv);
      MeldexDnD.setCaretFromPoint(e);

      const nodeData = MeldexDnD.parseMeldexNode(e);
      if (nodeData) {
        if (typeof this._insertLinkResultIntoText === 'function') {
          this._insertLinkResultIntoText(textDiv, null, { type: 'file', name: nodeData.name, path: nodeData.path });
          return;
        }
        // ファイル名テキストを挿入し、linkDict に登録して自動リンク化
        const { name, path } = nodeData;
        this._pushUndo('リンク挿入');
        document.execCommand('insertText', false, name);
        if (typeof linkDict !== 'undefined' && Array.isArray(linkDict)) {
          if (!linkDict.some(d => d.text === name && d.path === path)) {
            linkDict.push({ text: name, path });
          }
        }
        this._syncRowFromDom(textDiv, { skipUndo: true });
        this._applyAutoLinks(textDiv);
        return;
      }

      const annData = e.dataTransfer.getData('application/x-annotation');
      if (annData) {
        try {
          const ann = JSON.parse(annData);
          this._pushUndo('アノテートテキスト挿入');
          document.execCommand('insertText', false, ann.text || '[メモ]');
          this._syncRowFromDom(textDiv, { skipUndo: true });
        } catch {}
        return;
      }

      const calData = e.dataTransfer.getData('application/x-cal-event');
      if (calData) {
        const text = e.dataTransfer.getData('text/plain') || '[イベント]';
        this._pushUndo('イベントテキスト挿入');
        document.execCommand('insertText', false, text);
        this._syncRowFromDom(textDiv, { skipUndo: true });
        return;
      }
    });
  }

  // 自動リンク（linkDict）をテキスト要素に適用（表示のみ、data-auto-link属性で識別）
  _applyAutoLinks(textEl) {
    if (typeof MeldexAutoLink !== 'undefined') {
      MeldexAutoLink.applyToDom(textEl, this._path || this.doc?.source?.path || '');
    }
  }

  _markDirty(options = {}) {
    if (this._readOnly) {
      // 詳細パネル等の間接入口が先にモデルを書き換えても、ロック取得時の
      // スナップショットへ戻してdirty化・下書き・PUTを発生させない。
      if (this._readOnlySnapshot) {
        try {
          this.doc = createScriptNoteDoc(JSON.parse(this._readOnlySnapshot));
          this._calcCache = null;
          this._render();
        } catch {}
      }
      if (typeof showStatus === 'function') showStatus('編集ロック中のため変更できません', true);
      return false;
    }
    this._dirty = true;
    // 本体の2秒autosaveより先に、通常編集を回復用ストアへ退避する。
    // MeldexDraftRecovery.queueDraft()側が同一pathを250msでデバウンスするため、
    // 連続入力でIndexedDB書込を増やさず、保存・遷移失敗時にも直近内容を残せる。
    if (this._path && this.doc) {
      try {
        const draftJson = JSON.stringify(serializeScriptNoteDoc(this.doc), null, 2);
        window.MeldexDraftRecovery?.queueDraft?.(
          this._path,
          draftJson,
          this._lastSavedEtag || '',
        );
      } catch (_) {
        // 下書き直列化の失敗で編集操作自体を壊さない。本体save()/flush()側でも
        // 失敗時にsaveDraft()をawaitし、閉鎖・遷移を停止する。
      }
    }
    this._scheduleSave();
    // sync-from-dom の最中（= 既に _pushUndo 処理中のフラッシュ経路）では
    // デバウンス undo を仕込み直さない。再発火ループ防止。
    if (this._inSyncingFromDom) return;
    // テキスト入力のundoは500msデバウンス（skipUndo指定時はスキップ）
    if (!options.skipUndo) {
      if (this._undoTimer) clearTimeout(this._undoTimer);
      this._undoTimer = setTimeout(() => { this._undoTimer = null; this._pushUndo('編集'); }, 500);
    }
  }

  _scheduleSave() {
    if (typeof markAutoVersionDirty === 'function') markAutoVersionDirty(this._path, 'file');
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.save(); }, 2000);
  }

  // === Undo/Redo → gb-scriptnote-history.js に移動 ===

  // === 行の複数選択 → gb-scriptnote-selection.js に移動 ===

  // === 詳細パネル → gb-scriptnote-detail.js に移動 ===
  // === 列リサイズ・カスタム列 → gb-scriptnote-columns.js に移動 ===

  // === フィルタ → gb-scriptnote-filter.js に移動 ===

  // === ルビ ===

  _insertRuby() {
    const context = this._rubySelectionContext();
    if (!context) return;
    // 書式ポップアップの selectionchange 再表示を抑止し、ルビ専用UIだけを開く。
    if (typeof window.GBTextSelectionFormat?.suppressFor === 'function') {
      window.GBTextSelectionFormat.suppressFor(1200);
    } else if (typeof window.GBTextSelectionFormat?.close === 'function') {
      window.GBTextSelectionFormat.close();
    }
    this._openLegacyRubyPopup(context);
  }

  // ルビ挿入可能な選択状態なら { sel, range, text, textEl } を返す（単一テキストセル内の非空選択のみ）
  _rubySelectionContext() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const textEl = range.startContainer.closest?.('.sn2-text') || range.startContainer.parentElement?.closest?.('.sn2-text');
    if (!textEl || !this._rangeWithinElement(range, textEl)) return null;
    return { sel, range, text, textEl };
  }

  _selectedRubySpan(range, textEl) {
    if (!range || !textEl) return null;
    const start = range.startContainer?.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer?.parentElement;
    const end = range.endContainer?.nodeType === Node.ELEMENT_NODE
      ? range.endContainer
      : range.endContainer?.parentElement;
    const startSpan = start?.closest?.('[data-ruby]') || null;
    const endSpan = end?.closest?.('[data-ruby]') || null;
    if (!startSpan || startSpan !== endSpan || !textEl.contains(startSpan)) return null;
    return range.toString().trim() === String(startSpan.textContent || '').trim() ? startSpan : null;
  }

  // 選択範囲をルビスパンへ置き換えて保存・表示を更新する（レガシーポップアップと
  // 書式設定ポップアップ内ルビ入力の共通経路）。挿入できたら true
  _applyRubyToSelection(range, textEl, ruby, addRule) {
    if (!range || !textEl || !ruby) return false;
    const text = range.toString().trim();
    if (!text) return false;
    this._pushUndo('ルビ追加');
    let rubyNode = this._selectedRubySpan(range, textEl);
    if (rubyNode) {
      rubyNode.dataset.ruby = ruby;
    } else {
      // 選択範囲を削除してルビスパンを挿入（インラインstyleはCSSに任せる）
      range.deleteContents();
      rubyNode = document.createElement('span');
      rubyNode.dataset.ruby = ruby;
      rubyNode.textContent = text;
      range.insertNode(rubyNode);
    }
    // insertNodeが作る空テキストノードを除去して改行を防止
    textEl.normalize();
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.setStartAfter(rubyNode);
      newRange.collapse(true);
      sel.addRange(newRange);
    }
    // DOMからrow.textに同期（ルビマークアップ {漢字|ルビ} をrow.textに保存）
    this._syncRowFromDom(textEl, { skipUndo: true });
    // 自動ルビルールにも追加
    if (addRule) {
      if (!this.doc.rubyRules) this.doc.rubyRules = [];
      const exists = this.doc.rubyRules.some(r => r.text === text && r.ruby === ruby);
      if (!exists) this.doc.rubyRules.push({ text, ruby, auto: true });
    }
    this._markDirty({ skipUndo: true });
    if (typeof MeldexRubyPresentation !== 'undefined') MeldexRubyPresentation.refreshRubyNodes(this);
    this._adjustRubySpacing();
    return true;
  }

  _openLegacyRubyPopup(context) {
    const { range, text, textEl } = context;
    if (typeof this._closeRubyPopup === 'function') this._closeRubyPopup({ restoreFocus: false });
    // ルビ入力ポップアップ
    const popup = document.createElement('div');
    popup.className = 'sn2-header-popup sn2-ruby-popup';
    popup.dataset.e2eId = 'sn2-ruby-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-labelledby', 'sn2-ruby-label');

    const title = document.createElement('div');
    title.id = 'sn2-ruby-label';
    title.className = 'sn2-ruby-popup-title';
    title.dataset.e2eId = 'sn2-ruby-label';
    const existingRuby = this._selectedRubySpan(range, textEl);
    title.textContent = `「${text.slice(0, 20)}」のルビを${existingRuby ? '編集' : '追加'}`;

    const mainRow = document.createElement('div');
    mainRow.className = 'sn2-ruby-popup-main';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'sn2-ruby-input';
    input.className = 'gb-input-sm sn2-ruby-popup-input';
    input.dataset.e2eId = 'sn2-ruby-input';
    input.placeholder = 'ルビを入力...';
    input.value = existingRuby ? String(existingRuby.dataset.ruby || '') : '';
    input.setAttribute('aria-label', '選択文字のルビ');
    // 開くと同時に自動フォーカスされるため、フォーカス由来のツールチップは出さない
    input.setAttribute('data-gb-tooltip-disabled', 'true');
    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.id = 'sn2-ruby-ok';
    okButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary sn2-ruby-popup-ok';
    okButton.dataset.e2eId = 'sn2-ruby-ok';
    okButton.textContent = existingRuby ? '更新' : '追加';
    mainRow.append(input, okButton);

    const optionRow = document.createElement('div');
    optionRow.className = 'sn2-ruby-popup-options';
    const addRuleLabel = document.createElement('label');
    addRuleLabel.className = 'gb-check sn2-ruby-popup-check';
    addRuleLabel.dataset.e2eId = 'sn2-ruby-add-rule-label';
    const addRuleInput = document.createElement('input');
    addRuleInput.type = 'checkbox';
    addRuleInput.id = 'sn2-ruby-add-rule';
    addRuleInput.className = 'gb-checkbox';
    addRuleInput.dataset.e2eId = 'sn2-ruby-add-rule';
    const addRuleText = document.createElement('span');
    addRuleText.textContent = '自動ルビルールにも追加';
    addRuleLabel.append(addRuleInput, addRuleText);
    const autoButton = document.createElement('button');
    autoButton.type = 'button';
    autoButton.id = 'sn2-ruby-auto';
    autoButton.className = 'gb-btn gb-btn-sm gb-btn-quiet sn2-ruby-popup-auto';
    autoButton.dataset.e2eId = 'sn2-ruby-auto';
    autoButton.textContent = '読み取得';
    // 選択時書式ポップアップのルビ行と同じ並び（読み取得 → ルール追加）に揃える
    optionRow.append(autoButton, addRuleLabel);
    popup.append(title, mainRow, optionRow);
    const rr = range.getBoundingClientRect();
    popup.style.cssText += 'position:fixed;z-index:10000;min-width:240px;';
    positionPopup(popup, rr);
    input.focus();
    let closeHandler = null;
    let keyHandler = null;
    const restoreFocus = () => {
      if (!textEl?.isConnected) return;
      // 遅延実行の間に別のポップアップ等がフォーカスを取った場合は奪い返さない
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== textEl && !textEl.contains(ae)) return;
      try { textEl.focus({ preventScroll: true }); }
      catch { textEl.focus(); }
    };
    const closeRubyPopup = (options = {}) => {
      if (typeof window.GBTextSelectionFormat?.suppressFor === 'function') {
        window.GBTextSelectionFormat.suppressFor(800);
      }
      popup.remove();
      if (closeHandler) document.removeEventListener('pointerdown', closeHandler);
      if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
      if (this._rubyPopup === popup) {
        this._rubyPopup = null;
        this._closeRubyPopup = null;
      }
      if (options.restoreFocus !== false) {
        restoreFocus();
        requestAnimationFrame(restoreFocus);
      }
    };
    this._rubyPopup = popup;
    this._closeRubyPopup = closeRubyPopup;
    const apply = (ruby) => {
      if (!ruby) { closeRubyPopup(); return; }
      this._applyRubyToSelection(range, textEl, ruby, addRuleInput.checked);
      closeRubyPopup();
    };
    okButton.addEventListener('click', () => apply(input.value.trim()));
    input.addEventListener('keydown', (ev) => {
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        apply(input.value.trim());
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeRubyPopup();
      }
    });
    autoButton.addEventListener('click', async () => {
      try {
        const res = await apiFetch('/ruby?text=' + encodeURIComponent(text));
        if (res?.ruby) input.value = res.ruby;
        else if (typeof showStatus === 'function') showStatus('この語の読みは設定に登録されていません', true);
      } catch (err) {
        if (typeof showStatus === 'function') showStatus('自動ルビエラー: ' + err.message, true);
      }
    });
    closeHandler = (ev) => { if (!popup.contains(ev.target)) closeRubyPopup(); };
    keyHandler = (ev) => {
      // Tab / Shift+Tab はポップアップ内の項目切り替え（選択時書式ポップアップと同じ挙動）
      if (ev.key === 'Tab') {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof gbCyclePopupFocus === 'function') gbCyclePopupFocus(popup, ev.shiftKey);
        return;
      }
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      closeRubyPopup();
    };
    window.addEventListener('keydown', keyHandler, true);
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 0);
  }

  // === 破棄 ===

  destroy() {
    this._closeRoleMenu();
    if (typeof this._closeRubyPopup === 'function') this._closeRubyPopup({ restoreFocus: false });
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    if (this._textInputUndoTimer) { clearTimeout(this._textInputUndoTimer); this._textInputUndoTimer = null; }
    if (typeof this._teardownWrapResizeObserver === 'function') this._teardownWrapResizeObserver();
    if (typeof this._stopRowBulkBarGuard === 'function') this._stopRowBulkBarGuard();
    // エディタレジストリから除去
    if (typeof _sn2Editors !== 'undefined') {
      const registeredPath = this._sn2RegisteredPath || this._path;
      const registeredScopeId = this._sn2RegisteredScopeId || this._historyScopeId;
      if (registeredPath && _sn2Editors[registeredPath] === this) delete _sn2Editors[registeredPath];
      if (registeredScopeId && _sn2Editors[registeredScopeId] === this) delete _sn2Editors[registeredScopeId];
    }
    if (this._caretSelChangeHandler) { document.removeEventListener('selectionchange', this._caretSelChangeHandler); this._caretSelChangeHandler = null; }
    if (this._copyHandler) { document.removeEventListener('copy', this._copyHandler); this._copyHandler = null; }
    if (typeof this._dragSelectionDocCleanup === 'function') {
      this._dragSelectionDocCleanup();
      this._dragSelectionDocCleanup = null;
    }
    // document.body上のフロートバー・一時UIを除去
    document.querySelectorAll('.sn2-row-bulk-bar, .gb-fmt-popup--bulk-edit, .sn2-drag-select-rect').forEach(el => el.remove());
    // セル範囲選択の表示クラスを除去（セル要素自体は残す。他インスタンスに影響しないようhost配下に限定）
    this.host?.querySelectorAll('.sn2-text-cell-selected, .sn2-grid-cell-selected').forEach(el => {
      el.classList.remove('sn2-text-cell-selected', 'sn2-grid-cell-selected');
    });
    if (this.host) this.host.innerHTML = '';
    this._bound = false;
  }
}

// Clip Studio / SEP 連携は gb-scriptnote-clipstudio.js に分離
