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
    this._syncRowFromDom(textEl);
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
    this.doc.rows.splice(idx + 1, 0, newRow);
    this._calcCache = null;
    // ルビ対応: 全体再描画で正しくDOMを構築
    this._render();
    this._markDirty();
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
    this._syncRowFromDom(prevText);
    this._syncRowFromDom(textEl);
    const cursorPos = this.doc.rows[prevIdx].text.length;
    this.doc.rows[prevIdx].text += this.doc.rows[idx].text;
    this.doc.rows.splice(idx, 1);
    this._calcCache = null;
    this._render();
    this._markDirty();
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
    this._syncRowFromDom(textEl);
    this._syncRowFromDom(nextText);
    const cursorPos = this.doc.rows[idx].text.length;
    this.doc.rows[idx].text += this.doc.rows[nextIdx].text;
    this.doc.rows.splice(nextIdx, 1);
    this._calcCache = null;
    this._render();
    this._markDirty();
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
    const clearCc = (el) => { delete el.dataset.ccBg; delete el.dataset.ccColor; delete el.dataset.ccWeight; delete el.dataset.ccSize; };
    const setCc = (el, gs) => { if (gs.bgColor) el.dataset.ccBg = gs.bgColor; if (gs.textColor) el.dataset.ccColor = gs.textColor; if (gs.fontWeight) el.dataset.ccWeight = gs.fontWeight; if (gs.fontSize) el.dataset.ccSize = gs.fontSize; };
    for (let i = startIdx; i < rows.length && i < calc.length; i++) {
      // 大区切り（primary）
      const gutter = rows[i].querySelector('.sn2-gutter:not(.sn2-gutter2)');
      if (gutter) {
        gutter.textContent = this._formatGutterPrimary(calc[i]);
        // 縦書き: 半角英数字を縦中横に再ラップ (textContent 設定で tcy span が消えるため)
        if (isVert) this._wrapTcy(gutter, 'sn2-tcy-wide');
        clearCc(gutter);
        if (calc[i].showPage && cc.primaryStyle) setCc(gutter, cc.primaryStyle);
      }
      // 小区切り（secondary）
      const gutter2 = rows[i].querySelector('.sn2-gutter2');
      if (gutter2) {
        gutter2.textContent = this._formatGutterSecondary(calc[i]);
        if (isVert) this._wrapTcy(gutter2, 'sn2-tcy-wide');
        clearCc(gutter2);
        if (calc[i].showPanel && cc.secondaryStyle) setCc(gutter2, cc.secondaryStyle);
      }
      // スタイル再適用
      const rowId = rows[i].dataset.rowId;
      const row = this.doc.rows.find(r => r.id === rowId);
      if (row) this._applyRowStyle(rows[i], row.role);
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
      if (node.nodeType === 3) { text += _sn2EscapeRubyText(node.textContent); return; }
      if (node.nodeType === 1) {
        if (node.dataset?.manualLink && node.dataset?.path && typeof this._formatManualLinkMarkup === 'function') {
          text += this._formatManualLinkMarkup(node.textContent, node.dataset.path);
          return;
        }
        // 自動ルビ・自動リンクはテキストのみ出力（マークアップを保存しない）
        if (node.dataset?.autoRuby || node.dataset?.autoLink) { text += _sn2EscapeRubyText(node.textContent); return; }
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

  // ルビの字間調整: 対象文字列の幅/高さに収まるルビは字間を広げ、収まらないルビは中央揃えではみ出す
  _adjustRubySpacing() {
    if (!this.host) return;
    const rubyEm = this.doc?.editor?.rubyFontSize || 0.55;
    const isVertical = this.doc?.editor?.viewMode === 'vertical';
    const spans = this.host.querySelectorAll('.sn2-text [data-ruby]');
    if (!spans.length) return;
    // 一括測定用の隠しコンテナ
    const measurer = document.createElement('div');
    measurer.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap;line-height:1;';
    if (isVertical) { measurer.style.writingMode = 'vertical-rl'; measurer.style.textOrientation = 'upright'; }
    this.host.appendChild(measurer);
    // CSS zoom による二重スケーリング防止: getBoundingClientRect() は zoom 後の値を返すが、
    // letter-spacing の CSS px 値は zoom で再スケーリングされるため、zoom で割って CSS 座標系に変換する
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    spans.forEach(span => {
      // センタリングは CSS auto margin で処理するため、ここでは letter-spacing のみ設定
      const baseSizeRaw = isVertical ? span.getBoundingClientRect().height : span.getBoundingClientRect().width;
      const baseSize = baseSizeRaw / z;
      const rubyText = span.dataset.ruby;
      if (!rubyText || baseSize <= 0) {
        span.style.removeProperty('--sn2-ruby-ls');
        return;
      }
      const numChars = [...rubyText].length;
      const spanFontSize = parseFloat(getComputedStyle(span).fontSize);
      const temp = document.createElement('span');
      temp.style.cssText = `font-size:${spanFontSize * rubyEm}px;line-height:1;`;
      temp.textContent = rubyText;
      measurer.appendChild(temp);
      const rubyNatSizeRaw = isVertical ? temp.getBoundingClientRect().height : temp.getBoundingClientRect().width;
      const rubyNatSize = rubyNatSizeRaw / z;
      temp.remove();
      const effectiveSize = baseSize * 0.9;
      if (numChars > 1 && rubyNatSize < effectiveSize) {
        // ルビが対象文字列幅に収まる: 字間を広げて対象文字列の90%幅に合わせる
        const ls = (effectiveSize - rubyNatSize) / numChars;
        span.style.setProperty('--sn2-ruby-ls', ls + 'px');
      } else {
        // 収まらない or 1文字: 字間なし（中央揃えではみ出す）
        span.style.removeProperty('--sn2-ruby-ls');
      }
    });
    measurer.remove();
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
          this._pushUndo('注釈テキスト挿入');
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
    this._dirty = true;
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
    if (typeof markAutoVersionDirty === 'function') markAutoVersionDirty();
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
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    // ルビ入力ポップアップ
    const popup = document.createElement('div');
    popup.className = 'sn2-header-popup';
    popup.style.padding = '8px 12px';
    popup.innerHTML = `
      <div style="font-size:12px;margin-bottom:6px;">「${(typeof esc === 'function' ? esc : s => s)(text.slice(0, 20))}」にルビを設定</div>
      <div style="display:flex;gap:4px;">
        <input type="text" id="sn2-ruby-input" placeholder="ルビを入力..." style="flex:1;padding:3px 6px;font-size:13px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;outline:none;">
        <button class="primary" style="padding:3px 8px;font-size:12px;" id="sn2-ruby-ok">設定</button>
      </div>
      <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
        <label style="font-size:11px;color:var(--fg2);cursor:pointer;display:flex;align-items:center;gap:3px;">
          <input type="checkbox" id="sn2-ruby-add-rule"> 自動ルビルールにも追加
        </label>
        <button type="button" style="padding:2px 6px;font-size:11px;background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--fg2);cursor:pointer;margin-left:auto;" id="sn2-ruby-auto">読み取得</button>
      </div>`;
    const rr = range.getBoundingClientRect();
    popup.style.cssText += 'position:fixed;z-index:10000;min-width:240px;';
    positionPopup(popup, rr);
    const input = popup.querySelector('#sn2-ruby-input');
    input.focus();
    const apply = (ruby) => {
      if (!ruby) { popup.remove(); return; }
      const addRule = popup.querySelector('#sn2-ruby-add-rule')?.checked;
      // テキスト内にルビマークアップを挿入: {漢字|ルビ}
      const textEl = range.startContainer.closest?.('.sn2-text') || range.startContainer.parentElement?.closest?.('.sn2-text');
      if (textEl) {
        this._pushUndo('ルビ設定');
        // 選択範囲を削除してルビスパンを挿入（インラインstyleはCSSに任せる）
        range.deleteContents();
        const rubyNode = document.createElement('span');
        rubyNode.dataset.ruby = ruby;
        rubyNode.textContent = text;
        range.insertNode(rubyNode);
        // insertNodeが作る空テキストノードを除去して改行を防止
        textEl.normalize();
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.setStartAfter(rubyNode);
        newRange.collapse(true);
        sel.addRange(newRange);
        // DOMからrow.textに同期（ルビマークアップ {漢字|ルビ} をrow.textに保存）
        this._syncRowFromDom(textEl);
        // 自動ルビルールにも追加
        if (addRule) {
          if (!this.doc.rubyRules) this.doc.rubyRules = [];
          const exists = this.doc.rubyRules.some(r => r.text === text && r.ruby === ruby);
          if (!exists) this.doc.rubyRules.push({ text, ruby, auto: true });
        }
        this._markDirty();
      }
      popup.remove();
    };
    popup.querySelector('#sn2-ruby-ok').addEventListener('click', () => apply(input.value.trim()));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        apply(input.value.trim());
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        popup.remove();
      }
    });
    popup.querySelector('#sn2-ruby-auto').addEventListener('click', async () => {
      try {
        const res = await apiFetch('/ruby?text=' + encodeURIComponent(text));
        if (res?.ruby) input.value = res.ruby;
        else if (typeof showStatus === 'function') showStatus('自動ルビの取得に失敗しました', true);
      } catch (err) {
        if (typeof showStatus === 'function') showStatus('自動ルビエラー: ' + err.message, true);
      }
    });
    const closeHandler = (ev) => { if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('pointerdown', closeHandler); } };
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 0);
  }

  // === 破棄 ===

  destroy() {
    this._closeRoleMenu();
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    if (this._textInputUndoTimer) { clearTimeout(this._textInputUndoTimer); this._textInputUndoTimer = null; }
    // エディタレジストリから除去
    if (this._path && typeof _sn2Editors !== 'undefined') delete _sn2Editors[this._path];
    if (this._caretSelChangeHandler) { document.removeEventListener('selectionchange', this._caretSelChangeHandler); this._caretSelChangeHandler = null; }
    if (this._copyHandler) { document.removeEventListener('copy', this._copyHandler); this._copyHandler = null; }
    // document.body上のフロートバー・一時UIを除去
    document.querySelectorAll('.sn2-row-bulk-bar, .gb-fmt-popup--bulk-edit, .sn2-drag-select-rect').forEach(el => el.remove());
    if (this.host) this.host.innerHTML = '';
    this._bound = false;
  }
}

// Clip Studio / SEP 連携は gb-scriptnote-clipstudio.js に分離
