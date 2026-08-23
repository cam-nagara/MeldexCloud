/* gb-scriptnote-columns.js: 台本エディタ v2 — 列管理（リサイズ、カスタム列追加/編集/削除、ヘッダーメニュー）
   ScriptNoteEditor.prototype を拡張する */

Object.assign(ScriptNoteEditor.prototype, {

  _startColResize(e, colId, resizerEl) {
    e.preventDefault();
    this._pushUndo('列幅変更');
    const isVertical = this.doc.editor?.viewMode === 'vertical';
    const startPos = isVertical ? e.clientY : e.clientX;
    const editor = this.host?.querySelector('.sn2-editor');
    if (!editor) return;
    if (!this.doc.editor.columnWidths) this.doc.editor.columnWidths = {};
    const headerCell = this.host?.querySelector(`.sn2-header-cell[data-col-id="${colId}"]`);
    let currentSize = this.doc.editor.columnWidths[colId];
    if (!currentSize) {
      currentSize = headerCell
        ? (isVertical ? headerCell.getBoundingClientRect().height : headerCell.getBoundingClientRect().width)
        : 80;
    }
    currentSize = Math.round(currentSize);
    const scrollEl = this.host?.querySelector('.sn2-scroll');
    const vcolVar = `--sn2-vcol-${colId}`;
    const colVar = `--sn2-col-${colId}`;
    const onMove = (ev) => {
      const delta = (isVertical ? ev.clientY : ev.clientX) - startPos;
      const newSize = Math.max(30, currentSize + delta);
      this.doc.editor.columnWidths[colId] = newSize;
      if (isVertical) {
        editor.style.setProperty(vcolVar, newSize + 'px');
        if (scrollEl) scrollEl.style.setProperty(vcolVar, newSize + 'px');
        if (headerCell) headerCell.style.height = newSize + 'px';
      } else {
        editor.style.setProperty(colVar, newSize + 'px');
        if (scrollEl) scrollEl.style.setProperty(colVar, newSize + 'px');
        if (colId === '_text') {
          editor.style.setProperty('--sn2-text-flex', '0 0 auto');
          if (scrollEl) scrollEl.style.setProperty('--sn2-text-flex', '0 0 auto');
        }
        if (headerCell) { headerCell.style.width = newSize + 'px'; headerCell.classList.remove('sn2-header-flex'); }
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // 縦書き: ヘッダーの高さ変更に合わせて全行の高さを再同期
      if (isVertical) {
        const header = scrollEl?.querySelector('.sn2-header');
        if (header) {
          const hH = header.offsetHeight;
          scrollEl.querySelectorAll('.sn2-row').forEach(r => { r.style.height = hH + 'px'; });
        }
      }
      this._markDirty();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  },

  _currentColSize(colId) {
    const isVertical = this.doc.editor?.viewMode === 'vertical';
    const headerCell = this.host?.querySelector(`.sn2-header-cell[data-col-id="${colId}"]`);
    const stored = Number(this.doc.editor?.columnWidths?.[colId]);
    if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
    if (headerCell) {
      const rect = headerCell.getBoundingClientRect();
      return Math.round(isVertical ? rect.height : rect.width);
    }
    return 80;
  },

  _applyColSize(colId, size) {
    if (!this.doc.editor.columnWidths) this.doc.editor.columnWidths = {};
    const newSize = Math.max(30, Math.round(Number(size) || 30));
    const isVertical = this.doc.editor?.viewMode === 'vertical';
    const editor = this.host?.querySelector('.sn2-editor');
    const scrollEl = this.host?.querySelector('.sn2-scroll');
    const headerCell = this.host?.querySelector(`.sn2-header-cell[data-col-id="${colId}"]`);
    this.doc.editor.columnWidths[colId] = newSize;
    if (isVertical) {
      const vcolVar = `--sn2-vcol-${colId}`;
      editor?.style.setProperty(vcolVar, newSize + 'px');
      scrollEl?.style.setProperty(vcolVar, newSize + 'px');
      if (headerCell) headerCell.style.height = newSize + 'px';
      const header = scrollEl?.querySelector('.sn2-header');
      if (header) {
        const headerHeight = header.offsetHeight;
        scrollEl.querySelectorAll('.sn2-row').forEach(rowEl => { rowEl.style.height = headerHeight + 'px'; });
      }
      return;
    }
    const colVar = `--sn2-col-${colId}`;
    editor?.style.setProperty(colVar, newSize + 'px');
    scrollEl?.style.setProperty(colVar, newSize + 'px');
    if (colId === '_text') {
      editor?.style.setProperty('--sn2-text-flex', '0 0 auto');
      scrollEl?.style.setProperty('--sn2-text-flex', '0 0 auto');
    }
    if (headerCell) {
      headerCell.style.width = newSize + 'px';
      headerCell.classList.remove('sn2-header-flex');
    }
  },

  _handleColResizerKeydown(e, colId) {
    const isVertical = this.doc.editor?.viewMode === 'vertical';
    const positiveKey = isVertical ? 'ArrowDown' : 'ArrowRight';
    const negativeKey = isVertical ? 'ArrowUp' : 'ArrowLeft';
    if (e.key !== positiveKey && e.key !== negativeKey) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 1 : 10;
    const delta = e.key === positiveKey ? step : -step;
    this._pushUndo('列幅変更');
    this._applyColSize(colId, this._currentColSize(colId) + delta);
    this._markDirty();
  },

  // === ヘッダーダブルクリックで列名編集 ===

  _startHeaderLabelEdit(cell, colId) {
    const isStandard = colId.startsWith('_');
    const customCols = this._getCustomColumns();
    const colDef = isStandard ? null : customCols.find(c => c.id === colId);
    const currentLabel = cell.textContent.replace('…', '').trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentLabel;
    input.setAttribute('aria-label', `${currentLabel || '列'}列名`);
    input.title = `${currentLabel || '列'}列名`;
    input.style.cssText = 'width:100%;padding:2px 4px;border:1px solid var(--blue,#4a90d9);border-radius:2px;background:var(--bg);color:var(--fg);font-size:11px;font-weight:600;outline:none;box-sizing:border-box;';
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      const newLabel = input.value.trim() || currentLabel;
      if (newLabel === currentLabel) {
        this._render();
        return;
      }
      this._pushUndo('列名変更');
      if (isStandard) {
        if (!this.doc.editor.columnLabels) this.doc.editor.columnLabels = {};
        this.doc.editor.columnLabels[colId] = newLabel;
      } else if (colDef) {
        colDef.label = newLabel;
      }
      this._markDirty();
      this._render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (finished) return;
        finished = true;
        input.value = currentLabel;
        this._render();
      }
    });
  },

  // === ヘッダーメニュー（セルクリックで表示） ===

  _getScriptNoteVisibleContentColumnIds() {
    return (typeof this._getVisibleColumnIds === 'function'
      ? this._getVisibleColumnIds({ includeHandle: false })
      : []).filter(columnId => columnId !== '_status');
  },

  _setScriptNoteColumnVisible(colId, visible) {
    const current = this._getScriptNoteVisibleContentColumnIds();
    if (!visible && current.includes(colId) && current.length <= 1) {
      if (typeof showStatus === 'function') showStatus('最後の内容列は非表示にできません', true);
      return false;
    }
    this._pushUndo('列表示変更');
    if (colId.startsWith('_')) {
      this.doc.editor.visibleStandardColumns ||= {};
      this.doc.editor.visibleStandardColumns[colId] = !!visible;
    } else {
      const column = this._getCustomColumns().find(item => item.id === colId);
      if (!column) return false;
      column.visible = !!visible;
    }
    const focusWasHidden = !visible && this._activeCellColId === colId;
    const oldIndex = current.indexOf(colId);
    this._markDirty();
    this._render();
    if (focusWasHidden) {
      const next = this._getScriptNoteVisibleContentColumnIds();
      const focusId = next[Math.min(Math.max(0, oldIndex), next.length - 1)];
      this._activeCellColId = focusId || null;
      requestAnimationFrame(() => this.host?.querySelector(`.sn2-header-cell[data-col-id="${MeldexEscape.cssIdent(focusId || '')}"]`)?.focus());
    }
    return true;
  },

  _showHeaderMenu(cell, colId) {
    // 既存メニュー・サブメニューを閉じる
    document.querySelectorAll('.sn2-header-popup, .sn2-header-sub-popup').forEach(el => el.remove());
    document.querySelectorAll('.sn2-header-cell[aria-expanded="true"]').forEach(el => {
      el.setAttribute('aria-expanded', 'false');
    });
    const isStandard = colId.startsWith('_');
    const customCols = this._getCustomColumns();
    const colDef = isStandard ? null : customCols.find(c => c.id === colId);

    // 現在の設定を取得
    const getSettings = () => {
      if (isStandard) {
        if (!this.doc.editor.standardColumnSettings) this.doc.editor.standardColumnSettings = {};
        if (!this.doc.editor.standardColumnSettings[colId]) this.doc.editor.standardColumnSettings[colId] = {};
        return this.doc.editor.standardColumnSettings[colId];
      }
      return colDef || {};
    };
    const settings = getSettings();

    const popup = document.createElement('div');
    popup.className = 'sn2-header-popup';
    popup.id = `sn2-header-popup-${String(colId || 'col').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', `${(cell.textContent || '列').trim() || '列'}列メニュー`);

    const mkSep = () => { const el = document.createElement('div'); el.className = 'sn2-header-popup-sep'; return el; };
    const mkItem = (text, active, onClick) => {
      const btn = document.createElement('button');
      btn.className = 'sn2-header-popup-item' + (active ? ' active' : '');
      btn.type = 'button';
      btn.textContent = text;
      btn.setAttribute('role', 'menuitem');
      btn.addEventListener('click', onClick);
      return btn;
    };
    // サブメニュー付きアイテム
    let openSub = null;
    const closeSub = () => {
      if (openSub) {
        openSub._triggerBtn?.setAttribute('aria-expanded', 'false');
        openSub.remove();
        openSub = null;
      }
    };
    const mkSubItem = (text, currentLabel, buildSub) => {
      const btn = document.createElement('button');
      btn.className = 'sn2-header-popup-item sn2-header-popup-sub-trigger';
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = `<span>${MeldexEscape.html(text)}: <b>${MeldexEscape.html(currentLabel)}</b></span><span class="sn2-header-popup-arrow">${lucide('chevronRight', 10)}</span>`;
      btn.addEventListener('click', () => {
        if (openSub?._triggerBtn === btn) { closeSub(); return; }
        closeSub();
        const sub = document.createElement('div');
        sub.className = 'sn2-header-sub-popup sn2-header-popup';
        sub._triggerBtn = btn;
        sub.setAttribute('role', 'menu');
        sub.setAttribute('aria-label', `${text}メニュー`);
        buildSub(sub);
        const bRect = btn.getBoundingClientRect();
        sub.style.cssText = 'position:fixed;z-index:10001;';
        document.body.appendChild(sub);
        btn.setAttribute('aria-expanded', 'true');
        positionPopup(sub, bRect, { prefer: 'right' });
        openSub = sub;
      });
      return btn;
    };

    // 配置（現在値+サブメニュー）
    // 縦書き（vertical-rl）では align は上下方向（left=上）、valign は左右方向（top=右）に
    // 対応するため、保存値はそのままにラベルだけを縦書き向けへ切り替える
    const isVerticalWriting = this.doc.editor?.viewMode === 'vertical';
    const alignLabels = isVerticalWriting
      ? { left: '上寄せ', center: '中央', right: '下寄せ' }
      : { left: '左寄せ', center: '中央', right: '右寄せ' };
    popup.appendChild(mkSubItem(isVerticalWriting ? '垂直' : '水平', alignLabels[settings.align] || alignLabels.left, (sub) => {
      ['left', 'center', 'right'].forEach((val) => {
        sub.appendChild(mkItem(alignLabels[val], settings.align === val, () => {
          this._pushUndo('列配置変更'); settings.align = val; this._markDirty(); this._render(); closePopup();
        }));
      });
    }));

    const valignLabels = isVerticalWriting
      ? { top: '右寄せ', middle: '中央', bottom: '左寄せ' }
      : { top: '上寄せ', middle: '中央', bottom: '下寄せ' };
    popup.appendChild(mkSubItem(isVerticalWriting ? '水平' : '垂直', valignLabels[settings.valign] || valignLabels.top, (sub) => {
      ['top', 'middle', 'bottom'].forEach((val) => {
        sub.appendChild(mkItem(valignLabels[val], settings.valign === val, () => {
          this._pushUndo('列配置変更'); settings.valign = val; this._markDirty(); this._render(); closePopup();
        }));
      });
    }));

    // テキスト折り返し（現在値+サブメニュー）
    const overflowLabels = { wrap: '折り返し', overflow: 'はみ出し', clip: '切り詰め' };
    popup.appendChild(mkSubItem('テキスト', overflowLabels[settings.overflow] || '折り返し', (sub) => {
      [['折り返し', 'wrap'], ['はみ出し', 'overflow'], ['切り詰め', 'clip']].forEach(([label, val]) => {
        sub.appendChild(mkItem(label, settings.overflow === val, () => {
          this._pushUndo('列配置変更'); settings.overflow = val; this._markDirty(); this._render(); closePopup();
        }));
      });
    }));

    popup.appendChild(mkSep());

    const standardLabels = {
      _gutter: '大区切り', _gutter2: '小区切り', _role: 'タイプ', _text: 'テキスト',
    };
    const visibilityItems = [
      ...Object.entries(standardLabels).map(([id, label]) => ({ id, label })),
      ...customCols.map(column => ({ id: column.id, label: column.label || column.id })),
    ];
    popup.appendChild(mkSubItem('列の表示', `${this._getScriptNoteVisibleContentColumnIds().length}列`, sub => {
      visibilityItems.forEach(item => {
        const isVisible = item.id.startsWith('_')
          ? this.doc.editor?.visibleStandardColumns?.[item.id] !== false
          : customCols.find(column => column.id === item.id)?.visible !== false;
        const button = mkItem(`${isVisible ? '✓ ' : ''}${item.label}`, isVisible, () => {
          if (this._setScriptNoteColumnVisible(item.id, !isVisible)) closePopup();
        });
        if (isVisible && this._getScriptNoteVisibleContentColumnIds().length <= 1) button.disabled = true;
        sub.appendChild(button);
      });
    }));
    const hiddenItems = visibilityItems.filter(item => item.id.startsWith('_')
      ? this.doc.editor?.visibleStandardColumns?.[item.id] === false
      : customCols.find(column => column.id === item.id)?.visible === false);
    hiddenItems.forEach(item => {
      popup.appendChild(mkItem(`${item.label}列を表示`, false, () => {
        if (this._setScriptNoteColumnVisible(item.id, true)) closePopup();
      }));
    });

    popup.appendChild(mkSep());

    // 列スタイル（背景色・テキスト色・書式・フォントサイズ）
    popup.appendChild(mkItem('列スタイル設定…', false, () => {
      closePopup();
      this._showColumnStylePopup(cell, colId);
    }));

    popup.appendChild(mkSep());

    // 列操作
    popup.appendChild(mkItem('列を追加（右に）', false, () => { closePopup(); this._addColumnAt(colId); }));
    if (!isStandard) {
      popup.appendChild(mkItem('列を複製', false, () => { closePopup(); this._duplicateColumn(colId); }));
    }
    // 採用状況列は採用状況機能のオン／オフだけで制御し、列表示メニューと競合させない。
    if (colId !== '_handle' && colId !== '_status') {
      popup.appendChild(mkItem('列を非表示', false, () => { closePopup(); this._setScriptNoteColumnVisible(colId, false); }));
    }
    if (!isStandard) {
      popup.appendChild(mkItem('列を削除', false, () => { closePopup(); this._deleteColumn(colId); }));
    }

    // 列固有メニュー
    if (colDef?.type === 'select') {
      popup.appendChild(mkSep());
      popup.appendChild(mkItem('選択肢を編集…', false, () => { closePopup(); this._editDropdownOptions(colId); }));
    }
    if (colDef?.type === 'number') {
      popup.appendChild(mkSep());
      popup.appendChild(mkItem('単位を設定…', false, () => { closePopup(); this._showUnitPopup(cell, colId); }));
    }

    let closeHandler = null;
    let escapeHandler = null;
    const closePopup = (options = {}) => {
      closeSub();
      popup.remove();
      cell.setAttribute('aria-expanded', 'false');
      if (closeHandler) {
        document.removeEventListener('pointerdown', closeHandler, true);
        closeHandler = null;
      }
      if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler, true);
        escapeHandler = null;
      }
      if (options.restoreFocus) cell.focus();
    };

    // 位置決め
    document.body.appendChild(popup);
    cell.setAttribute('aria-expanded', 'true');
    cell.setAttribute('aria-controls', popup.id);
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(popup, {
        trigger: cell,
        close: closePopup,
      });
    }
    popup.style.cssText = 'position:fixed;z-index:10000;';
    positionPopup(popup, cell.getBoundingClientRect());
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);

    closeHandler = (ev) => {
      if (!popup.contains(ev.target) && !openSub?.contains(ev.target) && !ev.target.closest?.('.gb-fmt-popup') && !ev.target.closest?.('.gb-palette-popup')) closePopup();
    };
    escapeHandler = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      closePopup({ restoreFocus: true });
    };
    document.addEventListener('keydown', escapeHandler, true);
    requestAnimationFrame(() => popup.querySelector('.sn2-header-popup-item')?.focus());
    setTimeout(() => {
      if (popup.isConnected) document.addEventListener('pointerdown', closeHandler, true);
    }, 0);
  },

  // === 列スタイル設定ポップアップ ===

  _showColumnStylePopup(anchorEl, colId) {
    document.querySelectorAll('.gb-fmt-popup--col-style').forEach(el => el.remove());
    if (!this.doc.editor.columnStyles) this.doc.editor.columnStyles = {};
    if (!this.doc.editor.columnStyles[colId]) this.doc.editor.columnStyles[colId] = {};
    const cs = this.doc.editor.columnStyles[colId];
    const safeColor = (value, fallback) => {
      const raw = String(value || '').trim();
      if (!raw) return fallback;
      if (raw === 'transparent') return raw;
      if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
      if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(raw)) return raw;
      if (/^var\(--[-_a-zA-Z0-9]+\)$/.test(raw)) return raw;
      return fallback;
    };
    const fontSize = Number.isFinite(Number(cs.fontSize)) ? Math.max(8, Math.min(48, Number(cs.fontSize))) : '';
    const bgColor = safeColor(cs.bgColor, 'transparent');
    const textColor = safeColor(cs.textColor, 'var(--fg)');
    const popup = document.createElement('div');
    popup.className = 'gb-fmt-popup gb-fmt-popup--col-style';
    popup.innerHTML = `
      <div class="sn2-col-style-title">列スタイル</div>
      <div class="sn2-col-style-row">
        <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg" data-csp="bgColor" style="background:${bgColor};" title="背景色"></button>
        <button type="button" class="gb-fmt-swatch gb-fmt-swatch-fg" data-csp="textColor" style="color:${textColor};" title="テキスト色">T</button>
        <button type="button" class="gb-fmt-btn${cs.fontWeight === 'bold' ? ' active' : ''}" data-csp-toggle-fmt="fontWeight" title="太字"><b>B</b></button>
        <button type="button" class="gb-fmt-btn${cs.fontStyle === 'italic' ? ' active' : ''}" data-csp-toggle-fmt="fontStyle" title="斜体"><i>I</i></button>
        <input type="number" class="gb-fmt-num gb-fmt-num--w54" data-csp-num="fontSize" value="${fontSize}" placeholder="px" min="8" max="48">
        <button type="button" class="gb-fmt-btn sn2-col-style-reset" data-csp-reset title="リセット">${lucide('rotateCcw', 12)}</button>
      </div>
      <div class="sn2-col-style-note">※ タイプ管理の設定が優先されます</div>`;
    let closeHandler = null;
    let escapeHandler = null;
    const closePopup = () => {
      popup.remove();
      if (closeHandler) {
        document.removeEventListener('pointerdown', closeHandler, true);
        closeHandler = null;
      }
      if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler, true);
        escapeHandler = null;
      }
    };
    const refresh = () => { this._refreshRowStyles(); this._markDirty(); };
    // カラーピッカー
    popup.querySelectorAll('[data-csp]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof openColorPalette === 'function') {
          openColorPalette(btn, cs[btn.dataset.csp] || '#888', (color) => {
            this._pushUndo('列スタイル変更');
            if (color === 'transparent') { delete cs[btn.dataset.csp]; } else { cs[btn.dataset.csp] = color; }
            if (btn.dataset.csp === 'bgColor') btn.style.background = cs.bgColor || 'transparent';
            if (btn.dataset.csp === 'textColor') btn.style.color = cs.textColor || 'var(--fg)';
            refresh();
          });
        }
      });
    });
    // B / I トグル
    popup.querySelectorAll('[data-csp-toggle-fmt]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._pushUndo('列スタイル変更');
        const prop = btn.dataset.cspToggleFmt;
        const activeVal = prop === 'fontWeight' ? 'bold' : 'italic';
        cs[prop] = cs[prop] === activeVal ? '' : activeVal;
        btn.classList.toggle('active', cs[prop] === activeVal);
        refresh();
      });
    });
    // サイズ
    popup.querySelectorAll('[data-csp-num]').forEach(inp => {
      inp.addEventListener('change', () => { this._pushUndo('列スタイル変更'); cs[inp.dataset.cspNum] = inp.value ? Number(inp.value) : ''; refresh(); });
    });
    // リセット
    popup.querySelector('[data-csp-reset]')?.addEventListener('click', () => {
      this._pushUndo('列スタイル変更');
      Object.keys(cs).forEach(k => delete cs[k]);
      popup.querySelector('[data-csp="bgColor"]').style.background = 'transparent';
      popup.querySelector('[data-csp="textColor"]').style.color = 'var(--fg)';
      popup.querySelectorAll('[data-csp-toggle-fmt]').forEach(b => b.classList.remove('active'));
      const sizeInp = popup.querySelector('[data-csp-num="fontSize"]'); if (sizeInp) sizeInp.value = '';
      refresh();
    });
    // (タイプ優先は常時有効 — トグル廃止)

    popup.style.cssText = 'position:fixed;z-index:10001;min-width:220px;';
    document.body.appendChild(popup);
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(popup, {
        trigger: anchorEl,
        close: closePopup,
      });
    }
    positionPopup(popup, anchorEl.getBoundingClientRect());
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
    escapeHandler = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      closePopup();
    };
    document.addEventListener('keydown', escapeHandler, true);
    setTimeout(() => {
      if (!popup.isConnected) return;
      closeHandler = (ev) => {
        if (!popup.contains(ev.target) && !ev.target.closest?.('.gb-palette-popup') && !ev.target.closest?.('.sn2-header-popup') && !ev.target.closest?.('.gb-fmt-popup')) {
          closePopup();
        }
      };
      document.addEventListener('pointerdown', closeHandler, true);
    }, 0);
  },

  // === 列追加（指定列の右に） ===

  _addColumnAt(afterColId) {
    this._showAddScriptNoteColumnModal(afterColId);
  },

  _showAddScriptNoteColumnModal(afterColId = null) {
    if (!this.doc || !globalThis.GBUI?.createModal) return;
    const owner = document.activeElement;
    this.doc.editor.customColumns ||= [];
    const body = document.createElement('div');
    body.className = 'sn2-column-modal-fields';
    body.innerHTML = `
      <label class="field"><span>列名</span><input class="gb-input" data-column-name value="新しい列"></label>
      <label class="field"><span>種類</span><select class="gb-select" data-column-type><option value="text">テキスト</option><option value="number">数値</option><option value="select">ドロップダウン</option></select></label>
      <label class="field"><span>幅(px)</span><input class="gb-input" data-column-width type="number" value="80" min="20" max="400"></label>
      <label class="field" data-column-options-wrap hidden><span>選択肢（改行区切り）</span><textarea class="gb-input" data-column-options rows="6"></textarea></label>`;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-secondary';
    cancel.textContent = 'キャンセル';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'gb-btn gb-btn-primary';
    add.textContent = '追加';
    add.dataset.e2eId = 'scriptnote-add-column-confirm';
    const name = body.querySelector('[data-column-name]');
    const type = body.querySelector('[data-column-type]');
    const width = body.querySelector('[data-column-width]');
    const optionsWrap = body.querySelector('[data-column-options-wrap]');
    const options = body.querySelector('[data-column-options]');
    let busy = false;
    const returnFocus = () => {
      if (owner?.isConnected && owner !== document.body) return owner;
      const columnId = afterColId || '_text';
      return this.host?.querySelector(`.sn2-header-cell[data-col-id="${MeldexEscape.cssIdent(columnId)}"]`) || this.host;
    };
    const restoreParentFocus = reason => {
      if (reason === 'submitted') return;
      setTimeout(() => {
        const target = returnFocus();
        const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(dialog => dialog.isConnected);
        const topDialog = dialogs[dialogs.length - 1];
        if (target?.isConnected && (!topDialog || topDialog.contains(target))) target.focus();
      }, 0);
    };
    const modal = globalThis.GBUI.createModal({
      id: 'scriptnote-add-column', title: '列を追加', body, footer: [cancel, add],
      variant: 'standard', geometryKey: 'scriptnote-add-column', minWidth: '0',
      extraClass: 'sn2-column-modal', initialFocus: name, returnFocus,
      closeLabel: '列の追加を閉じる', closeOnEsc: true, closeOnOverlay: true,
      onBeforeClose: reason => !busy || reason === 'submitted',
      onClose: restoreParentFocus,
    });
    modal.overlay.dataset.e2eId = 'scriptnote-add-column-overlay';
    modal.modal.dataset.e2eId = 'scriptnote-add-column-dialog';
    globalThis.GBScriptNoteDialogUI?.applyCompactTargets?.(modal.modal);
    const setBusy = next => {
      busy = next;
      modal.modal.setAttribute('aria-busy', next ? 'true' : 'false');
      add.disabled = next;
      cancel.disabled = next;
    };
    type.addEventListener('change', () => { optionsWrap.hidden = type.value !== 'select'; });
    cancel.addEventListener('click', () => modal.close('cancel'));
    add.addEventListener('click', async () => {
      if (busy) return;
      const label = name.value.trim();
      if (!label) {
        name.setCustomValidity('列名を入力してください');
        name.reportValidity();
        name.focus();
        return;
      }
      name.setCustomValidity('');
      const id = `col-${Date.now()}`;
      const rawWidth = Number(width.value);
      const column = {
        id, label, type: type.value,
        width: Math.max(20, Math.min(400, Number.isFinite(rawWidth) ? rawWidth : 80)),
        visible: true,
        ...(type.value === 'select'
          ? { options: options.value.split('\n').map(value => value.trim()).filter(Boolean) }
          : {}),
      };
      setBusy(true);
      try {
        await Promise.resolve();
        this._pushUndo('列追加');
        this.doc.editor.customColumns.push(column);
        const order = this._getVisibleColumnIds({ includeHandle: false }).filter(columnId => columnId !== id);
        const insertAt = order.indexOf(afterColId);
        order.splice(insertAt >= 0 ? insertAt + 1 : order.length, 0, id);
        this.doc.editor.columnOrder = order;
        this._markDirty();
        this._render();
        setBusy(false);
        modal.close('submitted');
        requestAnimationFrame(() => this.host?.querySelector(`.sn2-header-cell[data-col-id="${MeldexEscape.cssIdent(id)}"]`)?.focus());
      } catch (error) {
        if (typeof showStatus === 'function') showStatus(error?.message || String(error), true);
      } finally {
        if (modal.isOpen()) setBusy(false);
      }
    });
    modal.open();
    name.select();
  },

  // === 列を複製 ===

  _duplicateColumn(colId) {
    const customCols = this._getCustomColumns();
    const idx = customCols.findIndex(c => c.id === colId);
    if (idx < 0) return;
    const src = customCols[idx];
    const newId = 'col-' + Date.now();
    this._pushUndo('列複製');
    const dup = { ...src, id: newId, label: src.label + '（コピー）', options: src.options ? [...src.options] : undefined };
    customCols.splice(idx + 1, 0, dup);
    if (Array.isArray(this.doc.editor?.columnOrder)) {
      const order = this.doc.editor.columnOrder.filter(id => id !== newId && id !== '_handle');
      const orderIdx = order.indexOf(colId);
      order.splice(orderIdx >= 0 ? orderIdx + 1 : order.length, 0, newId);
      this.doc.editor.columnOrder = order;
    }
    // データも複製
    this.doc.rows.forEach(r => {
      if (r.columns && r.columns[colId] !== undefined) {
        r.columns[newId] = r.columns[colId];
      }
    });
    this._render();
    this._markDirty();
  },

  // === 列を削除 ===

  _deleteColumn(colId) {
    if (colId.startsWith('_')) {
      this._setScriptNoteColumnVisible(colId, false);
      return;
    }
    const colLabel = colId === '_gutter' ? '大区切り' : colId === '_gutter2' ? '小区切り' : colId === '_role' ? 'タイプ' : colId === '_status' ? '採用状況' : colId === '_text' ? 'テキスト'
      : (this._getCustomColumns().find(c => c.id === colId)?.label || colId);
    showConfirmDialog(`「${colLabel}」列を削除しますか？`, () => {
    this._pushUndo('列削除');
    const customCols = this._getCustomColumns();
    const idx = customCols.findIndex(c => c.id === colId);
    if (idx >= 0) customCols.splice(idx, 1);
    this.doc.rows.forEach(r => { if (r.columns) delete r.columns[colId]; });
    this._render();
    this._markDirty();
    }); // showConfirmDialog
  },

  // === ドロップダウン列の選択肢編集 ===

  _editDropdownOptions(colId) {
    const customCols = this._getCustomColumns();
    const colDef = customCols.find(c => c.id === colId);
    if (!colDef || colDef.type !== 'select') return;
    if (!globalThis.GBUI?.createModal) return;
    const owner = document.activeElement;
    const body = document.createElement('div');
    body.className = 'sn2-column-options-body';
    const field = document.createElement('label');
    field.className = 'field gb-field sn2-column-options-field';
    const label = document.createElement('span');
    label.className = 'gb-label';
    label.textContent = '選択肢（改行区切り）';
    const textarea = document.createElement('textarea');
    textarea.id = 'sn2-opt-edit';
    textarea.className = 'gb-textarea sn2-column-options-input';
    textarea.wrap = 'soft';
    textarea.style.setProperty('overflow-x', 'hidden', 'important');
    textarea.rows = 10;
    textarea.dataset.e2eId = 'scriptnote-column-options-input';
    field.append(label, textarea);
    body.appendChild(field);
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.id = 'sn2-opt-cancel'; cancel.className = 'gb-btn gb-btn-sm cancel-btn'; cancel.textContent = 'キャンセル';
    const save = document.createElement('button');
    save.type = 'button'; save.id = 'sn2-opt-ok'; save.className = 'gb-btn gb-btn-sm gb-btn-primary primary ok-btn'; save.textContent = '保存';
    const modalApi = globalThis.GBUI.createModal({
      id: 'scriptnote-column-options', title: `${colDef.label} — 選択肢を編集`, body, footer: [cancel, save],
      variant: 'standard', geometryKey: 'scriptnote-column-options', minWidth: '0',
      initialFocus: '#sn2-opt-edit', returnFocus: owner, closeLabel: '選択肢の編集を閉じる',
      closeOnEsc: true, closeOnOverlay: true,
    });
    modalApi.overlay.dataset.sn2Dialog = 'column-options';
    modalApi.overlay.dataset.e2eId = 'scriptnote-column-options-overlay';
    modalApi.modal.dataset.e2eId = 'scriptnote-column-options-dialog';
    modalApi.modal.classList.add('sn2-column-modal', 'sn2-column-options-modal');
    modalApi.body.classList.add('sn2-column-options-modal-body');
    modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
    globalThis.GBScriptNoteDialogUI?.applyCompactTargets?.(modalApi.modal);
    textarea.value = (colDef.options || []).join('\n');
    cancel.addEventListener('click', () => modalApi.close('cancel'));
    save.addEventListener('click', () => {
      this._pushUndo('選択肢編集');
      const nextOptions = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
      const allowed = new Set(nextOptions);
      let cleared = 0;
      (this.doc.rows || []).forEach(row => {
        const val = row.columns?.[colId];
        if (val !== undefined && val !== '' && !allowed.has(String(val))) {
          row.columns[colId] = '';
          cleared++;
        }
      });
      colDef.options = nextOptions;
      this._render();
      this._markDirty();
      if (cleared && typeof showStatus === 'function') showStatus(`削除された選択肢を使っていた${cleared}件の値を空にしました`);
      modalApi.close('submit');
    });
    modalApi.open();
    textarea.select();
  },

  // === 数値列の単位設定 ===

  _showUnitPopup(anchorEl, colId) {
    const customCols = this._getCustomColumns();
    const colDef = customCols.find(c => c.id === colId);
    if (!colDef || colDef.type !== 'number') return;
    document.querySelectorAll('.sn2-header-popup').forEach(el => el.remove());
    const popup = document.createElement('div');
    popup.className = 'sn2-header-popup';
    popup.style.padding = '8px 12px';
    popup.innerHTML = `
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">単位を設定</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <input type="text" id="sn2-unit-input" value="${esc(colDef.unit || '')}" placeholder="例: px, 円, kg"
          style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--fg);font-size:12px;outline:none;">
        <button type="button" class="primary" id="sn2-unit-ok" style="padding:4px 12px;font-size:12px;">OK</button>
      </div>`;
    popup.style.cssText += 'position:fixed;z-index:10000;min-width:200px;';
    document.body.appendChild(popup);
    let closeHandler = null;
    let escapeHandler = null;
    const close = () => {
      popup.remove();
      if (closeHandler) {
        document.removeEventListener('pointerdown', closeHandler, true);
        closeHandler = null;
      }
      if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler, true);
        escapeHandler = null;
      }
    };
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(popup, {
        trigger: anchorEl,
        close,
      });
    }
    positionPopup(popup, anchorEl.getBoundingClientRect());
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
    const input = popup.querySelector('#sn2-unit-input');
    input.focus();
    input.select();
    const save = () => {
      this._pushUndo('単位設定');
      colDef.unit = input.value.trim();
      this._render();
      this._markDirty();
      close();
    };
    popup.querySelector('#sn2-unit-ok').addEventListener('click', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') close();
    });
    escapeHandler = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      close();
    };
    document.addEventListener('keydown', escapeHandler, true);
    closeHandler = (ev) => { if (!popup.contains(ev.target)) close(); };
    setTimeout(() => {
      if (popup.isConnected) document.addEventListener('pointerdown', closeHandler, true);
    }, 0);
  },

  // === カスタム列追加（末尾に追加、既存メソッド） ===

  _addCustomColumn() {
    this._showAddScriptNoteColumnModal(null);
  },

});
