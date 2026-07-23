        });
      }
      this._setupPanSpacer(scroll, editor, viewMode);
      // スクロール位置を復元
      scroll.scrollTop = savedScrollTop;
      scroll.scrollLeft = viewMode === 'vertical' ? 0 : savedScrollLeft;
      if (viewMode === 'vertical') resetVerticalWrapHorizontalPosition();
      // 折り返し表示でも行コメントバッジを通常表示と同じタイミングで再描画する
      if (this._path && typeof CommentBadges !== 'undefined') {
        try { CommentBadges.refreshScriptnote(this._path, this.host); } catch {}
      }
      this._setupWrapResizeObserver(scroll, viewMode, wrapMode);
      return;
    }

    this.host.innerHTML = '';
    this.host.appendChild(scroll);
    this._bind();
    this._adjustRubySpacing();
    // 縦書き: ヘッダーの高さを測定し行に適用（ヘッダーと行の下端を揃える）
    // + テキストが折り返して幅が必要な行はmin-widthを拡張
    if (viewMode === 'vertical') {
      requestAnimationFrame(() => {
        const h = scroll.querySelector('.sn2-header');
        if (!h) return;
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        const hH = h.getBoundingClientRect().height / zV;
        scroll.querySelectorAll('.sn2-row').forEach(r => {
          r.style.height = hH + 'px';
          const txt = r.querySelector('.sn2-text');
          if (txt) {
            const rW = r.getBoundingClientRect().width / zV;
            const scrollW = txt.scrollWidth;
            if (scrollW > rW) {
              r.style.minWidth = scrollW + 'px';
            }
          }
        });
      });
    }
    this._setupPanSpacer(scroll, editor, viewMode);
    // スクロール位置を復元
    scroll.scrollTop = savedScrollTop;
    scroll.scrollLeft = savedScrollLeft;
    // Phase 2e-ii: 行コメントバッジを描画
    if (this._path && typeof CommentBadges !== 'undefined') {
      try { CommentBadges.refreshScriptnote(this._path, this.host); } catch {}
    }
  }

  // 右ドラッグパン用の余白スペーサーを設置する。
  // editor の content box には一切影響しないよう、絶対配置で
  // editor の右下から +60vw, +60vh の位置に1pxの不可視要素を置く。
  // これによりスクロール領域だけが拡張される。
  // 縦書き行リバースモードでは editor の最終flex子として水平
  // スペーサーも追加し、視覚的な左方向にもパン可能にする。
  _setupPanSpacer(scroll, editor, viewMode) {
    if (!scroll || !editor) return;
    // 既存のスペーサーをすべて除去（再描画時の蓄積防止）
    scroll.querySelectorAll('.sn2-pan-spacer').forEach(el => el.remove());
    editor.querySelectorAll(':scope > .sn2-pan-spacer-inline').forEach(el => el.remove());
    // 縦書き row-reverse モード: 視覚的左方向の余白用の inline スペーサー
    const wrapMode = !!this.doc.editor?.wrapMode;
    if (viewMode === 'vertical' && !wrapMode) {
      const inline = document.createElement('div');
      inline.className = 'sn2-pan-spacer-inline';
      inline.style.cssText = 'flex-shrink:0;width:60vw;height:1px;pointer-events:none;background:transparent;';
      editor.appendChild(inline);
    }
    // 横書き折り返しモード: 表の右側にさらにパン余白を追加
    if (wrapMode && viewMode !== 'vertical') {
      const inline = document.createElement('div');
      inline.className = 'sn2-pan-spacer-inline';
      inline.style.cssText = 'flex-shrink:0;width:60vw;height:1px;pointer-events:none;background:transparent;';
      editor.appendChild(inline);
    }
    // 全モード共通: editor の右下に絶対配置スペーサー
    const absSpacer = document.createElement('div');
    absSpacer.className = 'sn2-pan-spacer';
    scroll.appendChild(absSpacer);
    // レイアウト確定後に位置を計算
    const place = () => {
      if (!editor.isConnected || !absSpacer.isConnected) return;
      const wPx = Math.round(window.innerWidth * 0.6);
      const hPx = Math.round(window.innerHeight * 0.6);
      const right = editor.offsetLeft + editor.offsetWidth;
      const bottom = editor.offsetTop + editor.offsetHeight;
      absSpacer.style.left = (right + wPx) + 'px';
      absSpacer.style.top = (bottom + hPx) + 'px';
    };
    requestAnimationFrame(() => {
      place();
      // 折り返しモードや縦書きモードでは2フレーム目に再計算（高さ調整後の位置を反映）
      requestAnimationFrame(place);
    });
  }

  _buildRowEl(row, idx, calc, mergeDisplay = false, prevRow = null, prevCalc = null, customCols = null, visibleCols = null) {
    if (!customCols) customCols = this._getCustomColumns();
    const el = document.createElement('div');
    el.className = 'sn2-row';
    el.dataset.rowId = row.id;
    // 枠線設定（タイプごとのオプション設定で制御）
    const chara = row.role
      ? this.doc.characters.find(c => !c.isDefault && c.name === row.role)
      : this.doc.characters.find(c => c.isDefault);
    // dataset.kind: 'blank' (空ロール), 'break' (区切り), 'summary' (プロット), 'action', 'heading', 'dialogue'
    let kind = 'dialogue';
    if (!row.role) kind = 'blank';
    else if (chara?.isSummary) kind = 'summary';
    else if (chara?.isBreak) kind = 'break';
    else if (['dialogue', 'action', 'heading'].includes(chara?.kind)) kind = chara.kind;
    el.dataset.kind = kind;
    const showOutline = !!chara?.outline;
    if (showOutline) {
      el.dataset.outline = 'true';
      // タイプ固有の枠線色・太さをCSS変数で設定
      if (chara?.outlineColor) el.style.setProperty('--sn2-outline-color', chara.outlineColor);
      if (chara?.outlineWidth) el.style.setProperty('--sn2-outline-width', chara.outlineWidth + 'px');
    }
    // まとめ表示: 前行と同じガター値やタイプ値なら非表示フラグ
    const mergeGutter = mergeDisplay && prevRow && calc && idx > 0;
    const mergeRole = mergeDisplay && prevRow && prevRow.role === row.role && row.role;
    const visCols = { _handle: true, _gutter: true, _gutter2: true, _role: true, _status: !!this.doc.editor?.statusEnabled, _text: true, ...(this.doc.editor?.visibleStandardColumns || {}) };
    if (!this.doc.editor?.statusEnabled) visCols._status = false;

    // 列間枠線: どの列の右側に枠線を表示するかを判定
    const colBorderSet = this._getColumnBorderSet();
    const appendCell = (colId, cell) => {
      if (!cell) return;
      cell.dataset.colId = colId;
      const gridKey = `${row.id}\u001f${colId}`;
      if (this._gridCellSelection?.has(gridKey)) cell.classList.add('sn2-grid-cell-selected');
      el.appendChild(cell);
    };

    // チェックボックス + ドラッグハンドル（ハンドルdiv内にチェックボックスを配置）
    if (visCols._handle !== false) {
      const rowId = row.id;
      const handle = document.createElement('div');
      handle.className = 'sn2-handle';
      // 注意: HTML5 draggable は使わない (ドラッグ中 wheel がブロックされるため)。
      // pointer events ベースの自前ドラッグ (_bind 内) で移動を実装する。
      // シナリオ上ではツールチップを出さない（title属性は付けない）
      handle.addEventListener('click', (ev) => {
        if (this._suppressRowCheckClick) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.stopPropagation();
        this._toggleRowSelection(rowId, idx, ev.shiftKey, ev.ctrlKey || ev.metaKey);
      });
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'sn2-row-check';
      cb.dataset.e2eId = `sn-row-${rowId}-select`;
      cb.checked = this._rowSelection?.has(rowId) || false;
      cb.setAttribute('aria-label', `行を選択: ${idx + 1}`);
      cb.addEventListener('click', (ev) => {
        if (this._suppressRowCheckClick) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.stopPropagation();
        this._toggleRowSelection(rowId, idx, ev.shiftKey, ev.ctrlKey || ev.metaKey);
      });
      handle.appendChild(cb);
      const gripText = document.createElement('span');
      gripText.textContent = '⠿';
      gripText.style.cssText = 'pointer-events:none;';
      handle.appendChild(gripText);
      appendCell('_handle', handle);
    }

    // ガター（大区切り：ページ番号等）
    const gutter = visCols._gutter !== false ? document.createElement('div') : null;
    if (gutter) gutter.className = 'sn2-gutter';
    // ガター2（小区切り：コマ番号等）
    const gutter2 = visCols._gutter2 !== false ? document.createElement('div') : null;
    if (gutter2) gutter2.className = 'sn2-gutter sn2-gutter2';
    // 配置設定を取得するヘルパー
    const stdSettings = this.doc.editor?.standardColumnSettings || {};
    const getColSettings = (colId) => {
      if (colId.startsWith('_')) return stdSettings[colId] || {};
      const cd = customCols.find(c => c.id === colId);
      return cd || {};
    };
    const cc = this.doc.editor?.countConfig || {};
    if (gutter) {
      if (calc) {
        const gutterText = this._formatGutterPrimary(calc);
        const prevGutterText = (mergeGutter && prevCalc) ? this._formatGutterPrimary(prevCalc) : '';
        const showGutterText = !(mergeGutter && gutterText === prevGutterText);
        gutter.textContent = showGutterText ? gutterText : '';
        // countConfigスタイルはdata属性に保存し、_applyRowStyleで参照する
        if (showGutterText && cc.primaryStyle) {
          const gs = cc.primaryStyle;
          if (gs.bgColor) gutter.dataset.ccBg = gs.bgColor;
          if (gs.textColor) gutter.dataset.ccColor = gs.textColor;
          if (gs.fontWeight) gutter.dataset.ccWeight = gs.fontWeight;
          if (gs.fontSize) gutter.dataset.ccSize = gs.fontSize;
        }
      }
      const gutterSt = getColSettings('_gutter');
      if (gutterSt.align) gutter.style.textAlign = gutterSt.align;
      if (gutterSt.valign) gutter.dataset.valign = gutterSt.valign;
      if (colBorderSet.has('_gutter')) gutter.dataset.colBorderRight = '';
      appendCell('_gutter', gutter);
    }
    if (gutter2) {
      if (calc) {
        const gutter2Text = this._formatGutterSecondary(calc);
        const prevGutter2Text = (mergeGutter && prevCalc) ? this._formatGutterSecondary(prevCalc) : '';
        const showGutter2Text = !(mergeGutter && gutter2Text === prevGutter2Text);
        gutter2.textContent = showGutter2Text ? gutter2Text : '';
        if (showGutter2Text && cc.secondaryStyle) {
          const gs = cc.secondaryStyle;
          if (gs.bgColor) gutter2.dataset.ccBg = gs.bgColor;
          if (gs.textColor) gutter2.dataset.ccColor = gs.textColor;
          if (gs.fontWeight) gutter2.dataset.ccWeight = gs.fontWeight;
          if (gs.fontSize) gutter2.dataset.ccSize = gs.fontSize;
        }
      }
      const gutter2St = getColSettings('_gutter2');
      if (gutter2St.align) gutter2.style.textAlign = gutter2St.align;
      if (gutter2St.valign) gutter2.dataset.valign = gutter2St.valign;
      if (colBorderSet.has('_gutter2')) gutter2.dataset.colBorderRight = '';
      appendCell('_gutter2', gutter2);
    }

    // タイプボタン
    let roleBtn = null;
    if (visCols._role !== false) {
      roleBtn = document.createElement('button');
      roleBtn.className = 'sn2-role-btn';
      roleBtn.type = 'button';
      roleBtn.textContent = mergeRole ? '' : (row.role || '');
      roleBtn.setAttribute('aria-label', `タイプ: ${row.role || '未設定'}`);
      roleBtn.tabIndex = 0;
      roleBtn.dataset.rowId = row.id;
      roleBtn.dataset.e2eId = `sn-row-${row.id}-role`;
      const roleSt = getColSettings('_role');
      if (roleSt.align) roleBtn.style.textAlign = roleSt.align;
      if (roleSt.valign) roleBtn.dataset.valign = roleSt.valign;
      if (colBorderSet.has('_role')) roleBtn.dataset.colBorderRight = '';
      appendCell('_role', roleBtn);
    }

    let statusBtn = null;
    if (visCols._status !== false && this.doc.editor?.statusEnabled) {
      statusBtn = document.createElement('button');
      statusBtn.className = 'sn2-status-btn';
      statusBtn.type = 'button';
      statusBtn.dataset.rowId = row.id;
      statusBtn.dataset.e2eId = `sn-row-${row.id}-status`;
      const statusSt = getColSettings('_status');
      if (statusSt.align) statusBtn.style.justifyContent = statusSt.align === 'right' ? 'flex-end' : statusSt.align === 'center' ? 'center' : 'flex-start';
      if (statusSt.valign) statusBtn.dataset.valign = statusSt.valign;
      if (colBorderSet.has('_status')) statusBtn.dataset.colBorderRight = '';
      if (typeof this._renderRowStatusButton === 'function') this._renderRowStatusButton(statusBtn, row);
      statusBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._showRowStatusMenu?.(statusBtn, row, el);
      });
      appendCell('_status', statusBtn);
    }

    // テキスト
    let textDiv = null;
    if (visCols._text !== false) {
      textDiv = document.createElement('div');
      textDiv.className = 'sn2-text';
      textDiv.contentEditable = 'true';
      textDiv.dataset.rowId = row.id;
      textDiv.dataset.e2eId = `sn-row-${row.id}-text`;
      // 再描画をまたいでテキストセル範囲選択の表示を復元する
      if (this._textCellSelection?.has(row.id)) textDiv.classList.add('sn2-text-cell-selected');
      // ルビマークアップ {漢字|ルビ} をDOMに復元。エスケープ（\{ \| \} \\）を逆変換する
      const rowText = row.text || '';
      const manualLinkFrag = rowText && rowText.includes('](ml:') && typeof this._buildManualLinkFragment === 'function'
        ? this._buildManualLinkFragment(rowText)
        : null;
      if (manualLinkFrag) {
        textDiv.appendChild(manualLinkFrag);
      } else if (rowText && rowText.includes('{') && rowText.includes('|')) {
        const frag = document.createDocumentFragment();
        let last = 0;
        const re = _sn2NewRubyRegex();
        let m;
        while ((m = re.exec(rowText)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(_sn2UnescapeScriptNotePlainText(rowText.slice(last, m.index))));
          const span = document.createElement('span');
          span.dataset.ruby = _sn2UnescapeRubyText(m[2]);
          span.textContent = _sn2UnescapeRubyText(m[1]);
          frag.appendChild(span);
          last = m.index + m[0].length;
        }
        if (last < rowText.length) frag.appendChild(document.createTextNode(_sn2UnescapeScriptNotePlainText(rowText.slice(last))));
        textDiv.appendChild(frag);
      } else {
        textDiv.textContent = _sn2UnescapeScriptNotePlainText(rowText);
      }
      // 自動リンク（linkDict ルビ含む）→ シナリオ固有ルビの順で適用
      this._applyAutoLinks(textDiv);
      this._applyAutoRuby(textDiv);
      // D&D: フォルダツリー等からのドロップでリンク名テキストを挿入
      this._setupTextCellDrop(textDiv);
    }
    if (textDiv) {
      const textSt = getColSettings('_text');
      if (textSt.align) textDiv.dataset.align = textSt.align;
      if (textSt.valign) textDiv.dataset.valign = textSt.valign;
      if (textSt.overflow) textDiv.dataset.overflow = textSt.overflow;
      if (colBorderSet.has('_text')) textDiv.dataset.colBorderRight = '';
      appendCell('_text', textDiv);
    }

    // カスタム列
    if (!row.columns) row.columns = {};
    customCols.forEach(col => {
      const cell = document.createElement('div');
      cell.className = 'sn2-custom-cell';
      cell.dataset.colId = col.id;
      const isVMode = this.doc.editor?.viewMode === 'vertical';
      if (isVMode) {
        cell.style.height = `var(--sn2-vcol-${col.id}, ${col.width || 80}px)`;
      } else {
        cell.style.width = `var(--sn2-col-${col.id}, ${col.width || 80}px)`;
      }
      // 配置設定
      if (col.align) cell.dataset.align = col.align;
      if (col.valign) cell.dataset.valign = col.valign;
      const val = row.columns[col.id] ?? '';
      const colControlLabel = `${col.label || col.id || '列'}列`;
      if (col.type === 'number') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'sn2-custom-input';
        inp.dataset.e2eId = `sn-row-${row.id}-custom-${col.id}`;
        inp.setAttribute('aria-label', colControlLabel);
        inp.value = val;
        inp.addEventListener('change', () => {
          this._pushUndo('列値変更');
          const rawValue = inp.value;
          const numericValue = Number(rawValue);
          row.columns[col.id] = rawValue === '' ? '' : (Number.isFinite(numericValue) ? numericValue : '');
          this._markDirty({ skipUndo: true });
        });
        cell.appendChild(inp);
        // 単位表示
        if (col.unit) {
          const unitSpan = document.createElement('span');
          unitSpan.className = 'sn2-custom-unit';
          unitSpan.textContent = col.unit;
          cell.appendChild(unitSpan);
        }
      } else if (col.type === 'select' && Array.isArray(col.options)) {
        const sel = document.createElement('select');
        sel.className = 'sn2-custom-select';
        sel.dataset.e2eId = `sn-row-${row.id}-custom-${col.id}`;
        sel.setAttribute('aria-label', colControlLabel);
        col.options.forEach(opt => { const o = document.createElement('option'); o.value = opt; o.textContent = opt; sel.appendChild(o); });
        sel.value = val;
        sel.addEventListener('change', () => { this._pushUndo('列値変更'); row.columns[col.id] = sel.value; this._markDirty({ skipUndo: true }); });
        cell.appendChild(sel);
      } else {
        const inp = document.createElement('div');
        inp.className = 'sn2-custom-text';
        inp.contentEditable = 'true';
        inp.dataset.e2eId = `sn-row-${row.id}-custom-${col.id}`;
        inp.setAttribute('aria-label', colControlLabel);
        inp.textContent = val;
        this._applyAutoLinks(inp);
        this._applyAutoRuby(inp);
        if (col.overflow) inp.dataset.overflow = col.overflow;
        inp.addEventListener('input', () => {
          if (typeof this._scheduleAutoDecorate === 'function') this._scheduleAutoDecorate(inp);
        });
        inp.addEventListener('focusout', () => { this._pushUndo('列値変更'); row.columns[col.id] = inp.textContent || ''; this._markDirty({ skipUndo: true }); });
        cell.appendChild(inp);
      }
      if (colBorderSet.has(col.id)) cell.dataset.colBorderRight = '';
      appendCell(col.id, cell);
    });

    if (Array.isArray(visibleCols) && visibleCols.length) {
      visibleCols.map(col => col.id).forEach(colId => {
        const cell = Array.from(el.children).find(child => child.dataset?.colId === colId);
        if (cell) el.appendChild(cell);
      });
    }

    // 右端スペーサー（テキスト列が固定幅の場合、行の残り部分をページ背景色に）
    const spacer = document.createElement('div');
    spacer.className = 'sn2-row-spacer';
    el.appendChild(spacer);

    // キャラスタイル適用
    this._applyRowStyle(el, row.role);

    // 縦書き: 連続半角英数字を縦中横(tcy)で横組みブロック化
    if (this.doc.editor?.viewMode === 'vertical') {
      el.querySelectorAll('.sn2-gutter').forEach(c => this._wrapTcy(c, 'sn2-tcy-wide'));
      el.querySelectorAll('.sn2-role-btn, .sn2-custom-text').forEach(c => this._wrapTcy(c));
      if (textDiv) this._wrapTcy(textDiv);
    }

    return el;
  }

  // 連続半角英数字/記号をsn2-tcyスパンで囲む（縦中横）
  // テキストセル内のカーソル位置を「改行を含まない連続テキストの文字オフセット」
  // として取得する。DOM を書き換えても復元できるよう、span ラップや改行非依存
  // な安定座標にする。<br> は改行 1 文字としてカウントする。
  _getTextOffset(textEl) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return -1;
    const range = sel.getRangeAt(0);
    if (!textEl.contains(range.startContainer) && range.startContainer !== textEl) return -1;
    let offset = 0;
    let found = false;
    if (range.startContainer === textEl) {
      for (let i = 0; i < range.startOffset && i < textEl.childNodes.length; i++) {
        offset += this._textLenWithBr(textEl.childNodes[i]);
      }
      return offset;
    }
    const walk = (node) => {
      if (found) return;
      if (node === range.startContainer) {
        if (node.nodeType === 3) {
          offset += range.startOffset;
        } else {
          // element ノードがコンテナの場合: その要素の最初の startOffset 個分の
          // 子要素のテキスト長を加算
          for (let i = 0; i < range.startOffset && i < node.childNodes.length; i++) {
            offset += this._textLenWithBr(node.childNodes[i]);
          }
        }
        found = true;
        return;
      }
      if (node.nodeType === 3) {
        offset += node.textContent.length;
        return;
      }
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') { offset += 1; return; }
        for (const c of node.childNodes) {
          walk(c);
          if (found) return;
        }
      }
    };
    for (const c of textEl.childNodes) { walk(c); if (found) break; }
    return found ? offset : -1;
  }

  _textLenWithBr(node) {
    if (node.nodeType === 3) return node.textContent.length;
    if (node.nodeType === 1) {
      if (node.tagName === 'BR') return 1;
      let len = 0;
      for (const c of node.childNodes) len += this._textLenWithBr(c);
      return len;
    }
    return 0;
  }

  // _getTextOffset で取得したオフセットを使ってカーソルを復元する
  _setTextOffset(textEl, offset) {
    if (offset < 0) return;
    let remaining = offset;
    let placed = false;
    const walk = (node) => {
      if (placed) return;
      if (node.nodeType === 3) {
        if (remaining <= node.textContent.length) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          placed = true;
          return;
        }
        remaining -= node.textContent.length;
        return;
      }
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') {
          if (remaining === 0) {
            // BR の直前
            const range = document.createRange();
            range.setStartBefore(node);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            placed = true;
            return;
          }
          remaining -= 1;
          return;
        }
        for (const c of node.childNodes) {
          walk(c);
          if (placed) return;
        }
      }
    };
    for (const c of textEl.childNodes) { walk(c); if (placed) break; }
    if (!placed) {
      // 末尾にフォールバック
      this._focusText(textEl, 'end');
    }
  }

  _rangeWithinElement(range, el) {
    if (!range || !el) return false;
    return (range.startContainer === el || el.contains(range.startContainer))
      && (range.endContainer === el || el.contains(range.endContainer));
  }

  // デバウンス付きで自動ルビ/自動リンク/縦中横を再適用する。
  // 選択範囲がある場合はスキップ (ユーザー操作を邪魔しないため)。
  _scheduleAutoDecorate(textEl, delay = 200) {
    if (!textEl) return;
    if (!this._autoDecorateTimers) this._autoDecorateTimers = new WeakMap();
    const prev = this._autoDecorateTimers.get(textEl);
    if (prev) clearTimeout(prev);
    const run = () => {
      this._autoDecorateTimers.delete(textEl);
      if (this._imeComposing) return;
      const sel = window.getSelection();
      // 非 collapsed 選択中はスキップ (選択範囲が壊れる)
      if (sel && sel.rangeCount && !sel.isCollapsed) return;
      // textEl がまだ DOM に接続されている必要がある
      if (!textEl.isConnected) return;
      const offset = this._getTextOffset(textEl);
      // 既存装飾を剥がして text node を結合してから再適用する
      textEl.querySelectorAll('[data-auto-ruby], [data-auto-link], .sn2-tcy, .sn2-tcy-wide').forEach(span => {
        // data-ruby などユーザー定義のルビ span は剥がさない
        if (span.dataset && span.dataset.ruby && !span.dataset.autoRuby) return;
        if (span.classList.contains('auto-link') && !span.dataset?.autoLink) return;
        span.replaceWith(document.createTextNode(span.textContent));
      });
      textEl.normalize();
      this._applyAutoLinks(textEl);
      this._applyAutoRuby(textEl);
      if (this.doc?.editor?.viewMode === 'vertical') {
        this._wrapTcy(textEl);
      }
      if (offset >= 0) this._setTextOffset(textEl, offset);
      // カスタムキャレットも更新
      if (this._caretSelChangeHandler) this._caretSelChangeHandler();
    };
    if (delay > 0) {
      this._autoDecorateTimers.set(textEl, setTimeout(run, delay));
    } else {
      run();
    }
  }

  _wrapTcy(el, tcyCls = 'sn2-tcy') {
    const walk = (node) => {
      if (node.nodeType !== 3) return; // テキストノードのみ
      const text = node.textContent;
      // 連続する半角英数字・記号（スペース除く）を検出
      const re = /[a-zA-Z0-9!?.,;:'"()&%$#@+\-*/=<>[\]{}]+/g;
      let m, parts = [], last = 0;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index), tcy: false });
        parts.push({ text: m[0], tcy: true });
        last = m.index + m[0].length;
      }
      if (!parts.length) return;
      if (last < text.length) parts.push({ text: text.slice(last), tcy: false });
      const frag = document.createDocumentFragment();
      parts.forEach(p => {
        if (p.tcy) {
          const span = document.createElement('span');
          span.className = tcyCls;
          span.textContent = p.text;
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(p.text));
        }
      });
      node.parentNode.replaceChild(frag, node);
    };
    // 直接の子テキストノードのみ処理（span[data-ruby]等の中は触らない）
    [...el.childNodes].forEach(walk);
  }

  // === 行タイプ判定 ===

  // 設定駆動方針: タイプ名による暗黙判定は撤廃。空ロールのみ 'blank'、それ以外は 'dialogue'
  _detectKind(role) {
    if (!role) return 'blank';
    const r = String(role).trim();
    if (!r) return 'blank';
    return 'dialogue';
  }

  // 旧データ移行用: タイプ名から旧 kind を推測する（loadDoc 内の一回だけ使用）
  _legacyDetectKindByName(name) {
    if (!name) return 'blank';
    const r = String(name).trim();
    if (!r) return 'blank';
    const breaks = ['めくり', '改ページ', '白紙', '見開き', '巻頭カラー', 'トビラ絵', '場面転換', '暗転', '幕間'];
    if (breaks.includes(r)) return 'break';
    if (r === 'プロット') return 'summary';
    if (typeof PAGE_SETTINGS !== 'undefined' && Array.isArray(PAGE_SETTINGS) && PAGE_SETTINGS.includes(r)) return 'heading';
    const headings = ['柱', 'シーン', '○', 'シーン見出し', '第一幕', '第二幕', '第三幕', '場'];
    if (headings.some(h => r.startsWith(h)) || /^\d+\s*[.．]/.test(r)) return 'heading';
    if (typeof SPECIAL_CHARA !== 'undefined' && Array.isArray(SPECIAL_CHARA) && SPECIAL_CHARA.includes(r)) return 'action';
    const actions = ['ト書き', 'ト', '動作', '説明', 'N', 'ナレーション', 'ナレ', 'SE', 'ME', 'M',
                     'コマ外注釈', '擬音', 'モノローグ', '心の声', 'BGM', 'テロップ', '（間）',
                     '地の文', '独白', '傍白', '歌', '群衆'];
    if (actions.includes(r)) return 'action';
    return 'dialogue';
  }

  // === イベント ===

  _bind() {
    if (this._bound) return;
    this._bound = true;
    const host = this.host;

    // === ホイール/矩形選択/行コピー/右ドラッグパン → gb-scriptnote-interactions.js に移動 ===
    this._bindInteractionEvents(host);

    // === セルナビゲーション: クリックは「アクティブ化」のみ（即編集しない） ===
    // キャプチャフェーズで先に処理する。実際のmousedown→クリックの間にブラウザが
    // contentEditableへキャレットを置くが、この click ハンドラで contentEditable を
    // false に戻すため、同一フレーム内で「編集開始」の見た目には遷移しない。
    host.addEventListener('click', (e) => {
      const textEl = e.target.closest?.('.sn2-text, .sn2-custom-text');
      if (textEl && host.contains(textEl)) {
        const rowEl = textEl.closest('.sn2-row');
        if (!rowEl) return;
        const rowId = rowEl.dataset.rowId;
        const colId = textEl.dataset.colId || (textEl.closest('.sn2-custom-cell')?.dataset.colId) || '_text';
        if (this._cellEditMode && this._activeCellRowId === rowId && this._activeCellColId === colId) return;
        this._setActiveCell(rowId, colId, false);
        return;
      }
      const nativeCtrl = e.target.closest?.('.sn2-custom-input, .sn2-custom-select');
      if (nativeCtrl) {
        const customCell = nativeCtrl.closest('.sn2-custom-cell');
        const rowEl = nativeCtrl.closest('.sn2-row');
        if (!customCell || !rowEl || !host.contains(customCell)) return;
        const rowId = rowEl.dataset.rowId;
        const colId = customCell.dataset.colId;
        if (this._activeCellRowId === rowId && this._activeCellColId === colId) return;
        if (this._activeCellRowId) this._clearActiveCell?.();
        this._activeCellRowId = rowId;
        this._activeCellColId = colId;
        this._cellEditMode = true;
        customCell.classList.add('sn2-cell-active');
        nativeCtrl.focus();
      }
    }, true);

    host.addEventListener('dblclick', (e) => {
      const textEl = e.target.closest?.('.sn2-text, .sn2-custom-text');
      if (!textEl || !host.contains(textEl)) return;
      const rowEl = textEl.closest('.sn2-row');
      if (!rowEl) return;
      const rowId = rowEl.dataset.rowId;
      const colId = textEl.dataset.colId || (textEl.closest('.sn2-custom-cell')?.dataset.colId) || '_text';
      this._setActiveCell(rowId, colId, true);
    });

    // カスタムキャレット（太い線）
    let caretEl = null;
    // ブラウザの range.getClientRects() が 0 サイズを返すケース
    // (空セル / 改行直後 / DOM ミューテーション直後) の補完計算
    const computeFallbackRect = (range, textEl) => {
      const startContainer = range.startContainer;
      const startOffset = range.startOffset;
      const isVert = this.doc.editor?.viewMode === 'vertical';
      // TCY (tate-chu-yoko) 内のキャレットは縦書きモードでも横書きと同じ縦線にする
      let isInsideTcy = false;
      if (isVert && startContainer) {
        const el = startContainer.nodeType === 3 ? startContainer.parentElement : startContainer;
        isInsideTcy = !!(el?.closest?.('.sn2-tcy') || el?.closest?.('.sn2-tcy-wide'));
      }
      const effectiveVert = isVert && !isInsideTcy;
      const cs = getComputedStyle(textEl);
      // getComputedStyle は CSS ピクセル (ズーム未適用) を返すが、
      // getBoundingClientRect は CSS zoom 適用後の描画座標を返すため、
      // 加減算時は必ず _getZoom() を掛けて同じ座標系に揃える。
      const zFb = typeof _getZoom === 'function' ? _getZoom() : 1;
      const lineH = ((parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.6) || 16)) * zFb;
      const padTop = (parseFloat(cs.paddingTop) || 0) * zFb;
      const padLeft = (parseFloat(cs.paddingLeft) || 0) * zFb;
      const padRight = (parseFloat(cs.paddingRight) || 0) * zFb;
      const tr = textEl.getBoundingClientRect();
      // 横書きカーソル(縦線)を rect の右側に置くヘルパー
      const caretAfter = (r) => effectiveVert
        ? { left: r.left, top: r.bottom, right: r.right, bottom: r.bottom + 2, width: r.width, height: 2 }
        : { left: r.right, top: r.top, right: r.right + 2, bottom: r.bottom, width: 2, height: r.height };
      // 横書きカーソル(縦線)を rect の左側に置くヘルパー
      const caretBefore = (r) => effectiveVert
        ? { left: r.left, top: r.top, right: r.right, bottom: r.top + 2, width: r.width, height: 2 }
        : { left: r.left, top: r.top, right: r.left + 2, bottom: r.bottom, width: 2, height: r.height };
      // 1 文字分の rect を取得するヘルパー
      const charRect = (textNode, from, to) => {
        try {
          const r2 = document.createRange();
          r2.setStart(textNode, from);
          r2.setEnd(textNode, to);
          const r2rect = r2.getClientRects()[0] || r2.getBoundingClientRect();
          if (r2rect && (r2rect.width || r2rect.height)) return r2rect;
        } catch (e) {}
        return null;
      };
      // === Case A: startContainer がテキストノード ===
      if (startContainer.nodeType === 3) {
        // オフセット > 0: 1 文字戻した rect の右側にカーソル
        if (startOffset > 0) {
          const r = charRect(startContainer, startOffset - 1, startOffset);
          if (r) return caretAfter(r);
        }
        // オフセット 0: 先頭文字がある場合は左側にカーソル
        if (startContainer.length > 0) {
          const r = charRect(startContainer, 0, 1);
          if (r) return caretBefore(r);
        }
        // 空テキストノードの場合、prev/next をたどる
      }
      // === Case B: 直前の子要素を特定 ===
      let prev = null;
      if (startContainer.nodeType === 1 && startOffset > 0) {
        prev = startContainer.childNodes[startOffset - 1];
      } else if (startContainer.nodeType === 3) {
        prev = startContainer.previousSibling;
      }
      // prev がテキストノードなら最後の文字の右側にカーソル
      if (prev && prev.nodeType === 3 && prev.length > 0) {
        const r = charRect(prev, prev.length - 1, prev.length);
        if (r) return caretAfter(r);
      }
      // prev が BR なら次の行の先頭にカーソル
      if (prev && prev.nodeType === 1 && prev.tagName === 'BR') {
        const prr = prev.getBoundingClientRect();
        if (effectiveVert) {
          const x = prr.left - lineH;
          const y = tr.top + padTop;
          return { left: x, top: y, right: x + lineH, bottom: y + 16, width: lineH, height: 16 };
        }
        const x = tr.left + padLeft;
        const y = prr.bottom;
        return { left: x, top: y, right: x + 2, bottom: y + lineH, width: 2, height: lineH };
      }
      // それ以外（空セル等）: textEl の左上(横書き) / 右上(縦書き)
      if (effectiveVert) {
        const x = tr.right - padRight - lineH;
        const y = tr.top + padTop;
        return { left: x, top: y, right: x + lineH, bottom: y + 16, width: lineH, height: 16 };
      }
      const x = tr.left + padLeft;
      const y = tr.top + padTop;
      return { left: x, top: y, right: x + 2, bottom: y + lineH, width: 2, height: lineH };
    };

    const updateCaret = () => {
      const sel = window.getSelection();
      if (!sel?.isCollapsed || !sel.rangeCount) { if (caretEl) caretEl.style.display = 'none'; return; }
      const textEl = sel.anchorNode?.nodeType === 3
        ? sel.anchorNode.parentElement?.closest?.('.sn2-text')
        : sel.anchorNode?.closest?.('.sn2-text');
      if (!textEl || !host.contains(textEl)) { if (caretEl) caretEl.style.display = 'none'; return; }
      // 重要: caretEl は contenteditable な textEl の中ではなく、親の .sn2-row に置く。
      // textEl の子にすると caretEl が editable content として扱われ、入力文字が
      // caretEl に紛れ込んだり位置がずれたりする。
      const row = textEl.closest('.sn2-row');
      if (!row) { if (caretEl) caretEl.style.display = 'none'; return; }
      const range = sel.getRangeAt(0);
      let rect = range.getClientRects()[0] || range.getBoundingClientRect();
      // rect が 0 サイズなら推定で補完してカーソルを必ず表示する
      if (!rect || (!rect.height && !rect.width)) {
        rect = computeFallbackRect(range, textEl);
      }
      if (!rect) { if (caretEl) caretEl.style.display = 'none'; return; }
      const rowRect = row.getBoundingClientRect();
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      if (!caretEl) {
        caretEl = document.createElement('div');
        caretEl.className = 'sn2-custom-caret';
      }
      if (caretEl.parentElement !== row) row.appendChild(caretEl);
      const isVert = this.doc.editor?.viewMode === 'vertical';
      // TCY (tate-chu-yoko) 内のキャレットは縦書きモードでも横書きと同じ縦線にする
      let isInsideTcy = false;
      if (isVert && sel.anchorNode) {
        const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
        isInsideTcy = !!(el?.closest?.('.sn2-tcy') || el?.closest?.('.sn2-tcy-wide'));
      }
      const dx = (rect.left - rowRect.left) / z;
      const dy = (rect.top - rowRect.top) / z;
      if (isVert && !isInsideTcy) {
        // 縦書き: キャレットは横線
        caretEl.style.left = dx + 'px';
        caretEl.style.top = dy + 'px';
        caretEl.style.width = (rect.width || 16) / z + 'px';
        caretEl.style.height = '';
      } else {
        // 横書き or 縦中横内: キャレットは縦線
        caretEl.style.left = dx + 'px';
        caretEl.style.top = dy + 'px';
        caretEl.style.height = (rect.height || 16) / z + 'px';
        caretEl.style.width = '';
      }
      caretEl.style.display = '';
      caretEl.style.animation = 'none';
      caretEl.offsetHeight; // reflow — 点滅リセット
      caretEl.style.animation = '';
    };
    // 前回のリスナーを解除（タブ開閉によるリーク防止）
    if (this._caretSelChangeHandler) document.removeEventListener('selectionchange', this._caretSelChangeHandler);
    this._caretSelChangeHandler = updateCaret;
    document.addEventListener('selectionchange', updateCaret);
    // focusout 時は同期で隠さず、次フレームで本当に host 外に出たかを再確認する
    // (セル間のフォーカス移動中に瞬間的に隠れる現象の回避)
    host.addEventListener('focusout', () => {
      setTimeout(() => {
        const ae = document.activeElement;
        if (!host.contains(ae) && caretEl) caretEl.style.display = 'none';
      }, 0);
    });

    // IME 変換中は DOM を書き換えない (変換が切れるため)
    this._imeComposing = false;
    host.addEventListener('compositionstart', (e) => {
      this._imeComposing = true;
      const text = e.target.closest?.('.sn2-text');
      if (text && typeof this._beginTextInputUndo === 'function') this._beginTextInputUndo('編集');
    });
    host.addEventListener('compositionend', (e) => {
      this._imeComposing = false;
      // 変換確定後にデバウンスなしで 1 度再適用
      const text = e.target.closest?.('.sn2-text');
      if (text) {
        this._scheduleTextCellLiveResize?.(text);
        this._scheduleAutoDecorate(text, 0);
      }
    });

    host.addEventListener('beforeinput', (e) => {
      const text = e.target.closest?.('.sn2-text');
      if (!text || e.isComposing) return;
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') return;
      if (typeof this._beginTextInputUndo === 'function') this._beginTextInputUndo('編集');
    });

    host.addEventListener('input', (e) => {
      const text = e.target.closest?.('.sn2-text');
      if (!text) return;
      this._dirty = true;
      this._scheduleSave();
      // 編集のたびに自動ルビ/自動リンク/縦中横を再適用 (デバウンス)
      // IME 変換中はスキップ (compositionend 側で拾う)
      this._scheduleTextCellLiveResize?.(text);
      if (!this._imeComposing) this._scheduleAutoDecorate(text);
      // カーソルが見えるようスクロール追従（改行時にのみ重い処理を実行）
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          if (!sel?.rangeCount || !sel.isCollapsed) return;
          const r = sel.getRangeAt(0);
          const marker = document.createElement('span');
          marker.style.cssText = 'display:inline;';
          r.insertNode(marker);
          marker.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          const markerParent = marker.parentNode;
          const markerIndex = markerParent ? Array.prototype.indexOf.call(markerParent.childNodes, marker) : -1;
          marker.remove();
          // マーカー除去後にselectionを復元
          if (markerParent && markerIndex >= 0) {
            const restoreRange = document.createRange();
            restoreRange.setStart(markerParent, Math.min(markerIndex, markerParent.childNodes.length));
            restoreRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(restoreRange);
          }
        });
      } else {
        // settleWrapPacking は別メソッドのローカル const のため、ここからは参照できない。
        // ファイル分割前は同じスコープに居たが、現状のコード構造では到達不可能。
        // ReferenceError を防ぐため typeof で存在チェックしてから呼ぶ。
        // （未到達時は折り返し再パックが走らないが、次のフル再レンダリングで反映される）
        requestAnimationFrame(() => {
          if (typeof settleWrapPacking === 'function') settleWrapPacking();
        });
      }
    });

    host.addEventListener('keydown', (e) => {
      if (e.isComposing) return;

      // アクティブセル（クリックで強調表示のみ・未編集）に対する矢印/Tab/Enter/Escapeは
      // ここでナビゲーションとして処理する。編集中のセルや無関係のターゲットには影響しない。
      if (typeof this._isActiveNonEditingTarget === 'function' && this._isActiveNonEditingTarget(e.target)) {
        if (this._handleNavigationKeydown(e)) return;
      }

      // ネイティブコントロール（数値入力・選択肢）が編集中のとき、Escape/Tab/Enterでセル編集を抜ける
      if (this._cellEditMode && this._activeCellRowId) {
        const nativeCtrl = e.target.closest?.('.sn2-custom-input, .sn2-custom-select');
        if (nativeCtrl) {
          if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
            e.preventDefault(); e.stopPropagation();
            nativeCtrl.blur();
            const wrapperEl = this._getCellElement(this._activeCellRowId, this._activeCellColId);
            this._cellEditMode = false;
            if (wrapperEl) { wrapperEl.classList.add('sn2-cell-active'); wrapperEl.tabIndex = 0; wrapperEl.focus(); }
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault(); e.stopPropagation();
            nativeCtrl.blur();
            this._cellEditMode = false;
            // Tab はその行のタイプ選択メニューを開く（Shift+Tab は従来どおり前のセルへ移動）
            if (!e.shiftKey) {
              const roleBtn = nativeCtrl.closest('.sn2-row')?.querySelector('.sn2-role-btn');
              if (roleBtn) { this._showRoleMenu(roleBtn); return; }
            }
            this._navigateCell(e.shiftKey ? 'prev-col' : 'next-col');
            return;
          }
        }
      }

      const roleKeyTarget = e.target.closest?.('.sn2-role-btn');
      if (roleKeyTarget && typeof this._handleRoleCellKeydown === 'function' && this._handleRoleCellKeydown(roleKeyTarget, e)) return;

      // Tab: カスタム列テキストセル編集中もその行のタイプ選択メニューを開く
      // （メインテキストセルの Tab は part03 のテキストセル keydown で処理される）
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const customText = e.target.closest?.('.sn2-custom-text');
        const roleBtn = customText?.closest('.sn2-row')?.querySelector('.sn2-role-btn');
        if (roleBtn) { e.preventDefault(); this._showRoleMenu(roleBtn); return; }
      }

      // Ctrl+Z / Ctrl+Y (undo/redo) — テキスト内外どちらでも動作
      const lk = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && lk === 'z' && !e.shiftKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.undo', e)) return;
        e.preventDefault(); this.undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (lk === 'y' || (lk === 'z' && e.shiftKey))) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.redo', e)) return;
        e.preventDefault(); this.redo(); return;
      }
      // Ctrl+R: ルビ入力
      if ((e.ctrlKey || e.metaKey) && lk === 'r') {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.ruby', e)) return;
        e.preventDefault(); this._insertRuby(); return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (lk === 'f' || lk === 'h')) {
        const shortcutId = lk === 'h' ? 'scenario.replace' : 'scenario.search';
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById(shortcutId, e)) return;
        e.preventDefault();
        const searchBtn = this.host?.closest?.('.gb-se-root')?.querySelector?.('[data-sn-action="search"]') || null;
        this._showSearchReplacePopup?.(searchBtn);
        return;
      }
      // Ctrl+D: 行選択・セル範囲選択を解除
      if ((e.ctrlKey || e.metaKey) && lk === 'd' && !e.shiftKey && !e.altKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.deselectAll', e)) return;
        e.preventDefault();
        if (this._rowSelection?.size) this._clearRowSelection();
        if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
        if (this._textCellSelection?.size) this._clearTextCellSelection?.();
        this._lastSelectedIdx = -1;
        const dsel = window.getSelection();
        if (dsel?.rangeCount && !dsel.isCollapsed) dsel.collapseToStart();
        return;
      }
      // Alt+下: テキスト選択時にルビ設定を開く
      if (e.altKey && e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount) {
          const textEl = sel.anchorNode?.parentElement?.closest?.('.sn2-text');
          if (textEl) { e.preventDefault(); this._insertRuby(); return; }
        }
      }

      // PageUp/PageDown: 折り返しOFF時にスクロール
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !this.doc.editor?.wrapMode) {
        const sc = host.querySelector('.sn2-scroll');
        if (sc) {
          e.preventDefault();
          const isV = this.doc.editor?.viewMode === 'vertical';
          const activeText = e.target.closest?.('.sn2-text');
          const caretOffset = activeText ? this._getTextOffset(activeText) : -1;
          const scRect = sc.getBoundingClientRect();
          const textRect = activeText?.getBoundingClientRect?.() || null;
          const probeX = textRect
            ? Math.min(scRect.right - 8, Math.max(scRect.left + 8, textRect.left + Math.min(24, textRect.width || 24)))
            : scRect.left + Math.min(scRect.width / 2, 48);
          const probeY = textRect
            ? Math.min(scRect.bottom - 8, Math.max(scRect.top + 8, textRect.top + Math.min(18, textRect.height || 18)))
            : scRect.top + Math.min(scRect.height / 2, 48);
          const amount = (isV ? sc.clientWidth : sc.clientHeight) * 0.8;
          if (isV) sc.scrollLeft += e.key === 'PageUp' ? amount : -amount;
          else sc.scrollTop += e.key === 'PageUp' ? -amount : amount;
          if (activeText) {
            requestAnimationFrame(() => {
              let nextText = document.elementFromPoint(probeX, probeY)?.closest?.('.sn2-text') || null;
              if (!nextText || !sc.contains(nextText)) {
                nextText = [...sc.querySelectorAll('.sn2-text')].find((el) => {
                  const rect = el.getBoundingClientRect();
                  return rect.bottom > scRect.top && rect.top < scRect.bottom && rect.right > scRect.left && rect.left < scRect.right;
                }) || null;
              }
              if (nextText) {
                nextText.focus();
                if (caretOffset >= 0) this._setTextOffset(nextText, Math.min(caretOffset, this._textLenWithBr(nextText)));
              }
            });
          }
        }
        return;
      }

      // Ctrl+上下: 行入れ替え（縦書き時はCtrl+右/左）
      const isVert = this.doc.editor?.viewMode === 'vertical';
      const swapPrevKey = isVert ? 'ArrowRight' : 'ArrowUp';
      const swapNextKey = isVert ? 'ArrowLeft' : 'ArrowDown';
      if ((e.ctrlKey || e.metaKey) && (e.key === swapPrevKey || e.key === swapNextKey)) {
        const shortcutId = e.key === swapPrevKey ? 'scenario.moveUp' : 'scenario.moveDown';
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById(shortcutId, e)) return;
        const text = e.target.closest?.('.sn2-text');
        if (!text) return;
        e.preventDefault();
        const row = text.closest('.sn2-row');
        if (!row) return;
        const rowId = row.dataset.rowId;
        const idx = this.doc.rows.findIndex(r => r.id === rowId);
        if (idx < 0) return;
        const dir = e.key === swapPrevKey ? -1 : 1;
        // フィルタで非表示の行をスキップ
        let targetIdx = idx + dir;
        while (targetIdx >= 0 && targetIdx < this.doc.rows.length) {
          const targetRow = this.doc.rows[targetIdx];
          if (this._isRoleVisible(targetRow.role, targetRow.status || '')) break;
