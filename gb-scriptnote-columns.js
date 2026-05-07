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

  // === ヘッダーダブルクリックで列名編集 ===

  _startHeaderLabelEdit(cell, colId) {
    const isStandard = colId.startsWith('_');
    const customCols = this._getCustomColumns();
    const colDef = isStandard ? null : customCols.find(c => c.id === colId);
    const currentLabel = cell.textContent.replace('…', '').trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentLabel;
    input.style.cssText = 'width:100%;padding:2px 4px;border:1px solid var(--blue,#4a90d9);border-radius:2px;background:var(--bg);color:var(--fg);font-size:11px;font-weight:600;outline:none;box-sizing:border-box;';
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const newLabel = input.value.trim() || currentLabel;
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
      if (e.key === 'Escape') { input.value = currentLabel; input.blur(); }
    });
  },

  // === ヘッダーメニュー（セルクリックで表示） ===

  _showHeaderMenu(cell, colId) {
    // 既存メニュー・サブメニューを閉じる
    document.querySelectorAll('.sn2-header-popup, .sn2-header-sub-popup').forEach(el => el.remove());
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

    const mkSep = () => { const el = document.createElement('div'); el.className = 'sn2-header-popup-sep'; return el; };
    const mkItem = (text, active, onClick) => {
      const btn = document.createElement('button');
      btn.className = 'sn2-header-popup-item' + (active ? ' active' : '');
      btn.type = 'button';
      btn.textContent = text;
      btn.addEventListener('click', onClick);
      return btn;
    };
    // サブメニュー付きアイテム
    let openSub = null;
    const closeSub = () => { if (openSub) { openSub.remove(); openSub = null; } };
    const mkSubItem = (text, currentLabel, buildSub) => {
      const btn = document.createElement('button');
      btn.className = 'sn2-header-popup-item sn2-header-popup-sub-trigger';
      btn.type = 'button';
      btn.innerHTML = `<span>${text}: <b>${currentLabel}</b></span><span class="sn2-header-popup-arrow">${lucide('chevronRight', 10)}</span>`;
      btn.addEventListener('click', () => {
        if (openSub?._triggerBtn === btn) { closeSub(); return; }
        closeSub();
        const sub = document.createElement('div');
        sub.className = 'sn2-header-sub-popup sn2-header-popup';
        sub._triggerBtn = btn;
        buildSub(sub);
        const bRect = btn.getBoundingClientRect();
        sub.style.cssText = 'position:fixed;z-index:10001;';
        positionPopup(sub, bRect, { prefer: 'right' });
        openSub = sub;
      });
      return btn;
    };

    // 水平配置（現在値+サブメニュー）
    const alignLabels = { left: '左寄せ', center: '中央', right: '右寄せ' };
    popup.appendChild(mkSubItem('水平', alignLabels[settings.align] || '左寄せ', (sub) => {
      [['左寄せ', 'left'], ['中央', 'center'], ['右寄せ', 'right']].forEach(([label, val]) => {
        sub.appendChild(mkItem(label, settings.align === val, () => {
          this._pushUndo('列配置変更'); settings.align = val; this._markDirty(); this._render(); closePopup();
        }));
      });
    }));

    // 垂直配置（現在値+サブメニュー）
    const valignLabels = { top: '上寄せ', middle: '中央', bottom: '下寄せ' };
    popup.appendChild(mkSubItem('垂直', valignLabels[settings.valign] || '上寄せ', (sub) => {
      [['上寄せ', 'top'], ['中央', 'middle'], ['下寄せ', 'bottom']].forEach(([label, val]) => {
        sub.appendChild(mkItem(label, settings.valign === val, () => {
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
    if (colId !== '_handle') {
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

    // 非表示の標準列を復元
    const visCols = this.doc.editor?.visibleStandardColumns;
    if (visCols) {
      const hiddenLabels = { _gutter: '大区切り', _gutter2: '小区切り', _role: 'タイプ', _status: '採用状況', _text: 'テキスト' };
      const hiddenCols = Object.entries(hiddenLabels).filter(([id]) => (id !== '_status' || this.doc.editor?.statusEnabled) && visCols[id] === false);
      if (hiddenCols.length) {
        popup.appendChild(mkSep());
        hiddenCols.forEach(([id, label]) => {
          popup.appendChild(mkItem(`${label}列を表示`, false, () => {
            this._pushUndo('列表示変更'); visCols[id] = true; this._markDirty(); this._render(); closePopup();
          }));
        });
      }
    }

    let closeHandler = null;
    const closePopup = () => {
      closeSub();
      popup.remove();
      if (closeHandler) {
        document.removeEventListener('pointerdown', closeHandler);
        closeHandler = null;
      }
    };

    // 位置決め
    document.body.appendChild(popup);
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
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 0);
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
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">列スタイル</div>
      <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
        <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg" data-csp="bgColor" style="background:${bgColor};" title="背景色"></button>
        <button type="button" class="gb-fmt-swatch gb-fmt-swatch-fg" data-csp="textColor" style="color:${textColor};" title="テキスト色">T</button>
        <button type="button" class="gb-fmt-btn${cs.fontWeight === 'bold' ? ' active' : ''}" data-csp-toggle-fmt="fontWeight" title="太字"><b>B</b></button>
        <button type="button" class="gb-fmt-btn${cs.fontStyle === 'italic' ? ' active' : ''}" data-csp-toggle-fmt="fontStyle" title="斜体"><i>I</i></button>
        <input type="number" class="gb-fmt-num" data-csp-num="fontSize" value="${fontSize}" placeholder="px" min="8" max="48">
        <button type="button" class="gb-fmt-btn" data-csp-reset title="リセット" style="font-size:10px;margin-left:auto;">✕</button>
      </div>
      <div style="font-size:10px;color:var(--fg2);margin-top:4px;">※ タイプ管理の設定が優先されます</div>`;
    let closeHandler = null;
    const closePopup = () => {
      popup.remove();
      if (closeHandler) {
        document.removeEventListener('pointerdown', closeHandler);
        closeHandler = null;
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
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(popup, {
        trigger: anchorEl,
        close: closePopup,
      });
    }
    positionPopup(popup, anchorEl.getBoundingClientRect());
    setTimeout(() => {
      closeHandler = (ev) => {
        if (!popup.contains(ev.target) && !ev.target.closest?.('.gb-palette-popup') && !ev.target.closest?.('.sn2-header-popup') && !ev.target.closest?.('.gb-fmt-popup')) {
          closePopup();
        }
      };
      document.addEventListener('pointerdown', closeHandler);
    }, 0);
  },

  // === 列追加（指定列の右に） ===

  _addColumnAt(afterColId) {
    if (!this.doc) return;
    if (!this.doc.editor.customColumns) this.doc.editor.customColumns = [];
    const id = 'col-' + Date.now();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" style="min-width:480px;max-width:640px;">
      <h3>列を追加</h3>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:8px;min-height:300px;">
        <div class="field"><label>列名</label><input type="text" id="sn2-col-name" value="新しい列" style="width:100%;padding:4px 6px;"></div>
        <div class="field"><label>タイプ</label>
          <select id="sn2-col-type" style="width:100%;padding:4px 6px;">
            <option value="text">テキスト</option>
            <option value="number">数値</option>
            <option value="select">ドロップダウン</option>
          </select>
        </div>
        <div class="field" id="sn2-col-options-wrap" style="display:none;">
          <label>選択肢（改行区切り）</label>
          <textarea id="sn2-col-options" rows="8" style="width:100%;padding:4px 6px;"></textarea>
        </div>
        <div class="field"><label>幅(px)</label><input type="number" id="sn2-col-width" value="80" min="20" max="400" style="width:80px;padding:4px 6px;"></div>
      </div>
      <div class="btn-row">
        <button class="btn" id="sn2-col-cancel">キャンセル</button>
        <button class="primary" id="sn2-col-ok">追加</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const typeSel = overlay.querySelector('#sn2-col-type');
    const optWrap = overlay.querySelector('#sn2-col-options-wrap');
    typeSel.addEventListener('change', () => { optWrap.style.display = typeSel.value === 'select' ? '' : 'none'; });
    overlay.querySelector('#sn2-col-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#sn2-col-ok').addEventListener('click', () => {
      const label = overlay.querySelector('#sn2-col-name').value.trim() || '列';
      const type = typeSel.value;
      const width = Number(overlay.querySelector('#sn2-col-width').value) || 80;
      const options = type === 'select'
        ? overlay.querySelector('#sn2-col-options').value.split('\n').map(s => s.trim()).filter(Boolean)
        : undefined;
      this._pushUndo('列追加');
      const newCol = { id, label, type, width, options };
      // afterColIdの位置を探して、その直後に挿入
      const afterIdx = this.doc.editor.customColumns.findIndex(c => c.id === afterColId);
      if (afterIdx >= 0) {
        this.doc.editor.customColumns.splice(afterIdx + 1, 0, newCol);
      } else {
        this.doc.editor.customColumns.push(newCol);
      }
      const statusEnabled = !!this.doc.editor?.statusEnabled;
      const visCols = { _gutter: true, _gutter2: true, _role: true, _status: statusEnabled, _text: true, ...(this.doc.editor?.visibleStandardColumns || {}) };
      if (!statusEnabled) visCols._status = false;
      const stdOrder = ['_gutter', '_gutter2', '_role', '_status', '_text'].filter(col => visCols[col] !== false);
      const customOrder = this.doc.editor.customColumns.filter(c => c.id !== id).map(c => c.id);
      let order = Array.isArray(this.doc.editor.columnOrder)
        ? this.doc.editor.columnOrder.filter(col => col !== '_handle' && col !== id)
        : [...stdOrder, ...customOrder];
      [...stdOrder, ...customOrder].forEach(col => { if (!order.includes(col)) order.push(col); });
      order = order.filter(col => stdOrder.includes(col) || customOrder.includes(col));
      const insertIdx = order.indexOf(afterColId);
      order.splice(insertIdx >= 0 ? insertIdx + 1 : 0, 0, id);
      this.doc.editor.columnOrder = order;
      this._render();
      this._markDirty();
      overlay.remove();
    });
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
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
    const colLabel = colId === '_gutter' ? '大区切り' : colId === '_gutter2' ? '小区切り' : colId === '_role' ? 'タイプ' : colId === '_status' ? '採用状況' : colId === '_text' ? 'テキスト'
      : (this._getCustomColumns().find(c => c.id === colId)?.label || colId);
    showConfirmDialog(`「${colLabel}」列を削除しますか？`, () => {
    this._pushUndo('列削除');
    const isStandard = colId.startsWith('_');
    if (isStandard) {
      // 標準列: visibleStandardColumnsで非表示にする
      if (!this.doc.editor.visibleStandardColumns) {
        this.doc.editor.visibleStandardColumns = { _handle: true, _gutter: true, _gutter2: true, _role: true, _status: !!this.doc.editor?.statusEnabled, _text: true };
      }
      // 最後の標準列（_handle除く）は削除不可
      const vis = this.doc.editor.visibleStandardColumns;
      const visibleCount = ['_gutter', '_gutter2', '_role', '_status', '_text']
        .filter(id => (id !== '_status' || this.doc.editor?.statusEnabled) && vis[id] !== false).length;
      if (visibleCount <= 1 && vis[colId] !== false) {
        if (typeof showStatus === 'function') showStatus('最後の標準列は削除できません', true);
        return;
      }
      vis[colId] = false;
    } else {
      // カスタム列: 配列から除去、各行のデータも除去
      const customCols = this._getCustomColumns();
      const idx = customCols.findIndex(c => c.id === colId);
      if (idx >= 0) customCols.splice(idx, 1);
      this.doc.rows.forEach(r => { if (r.columns) delete r.columns[colId]; });
    }
    this._render();
    this._markDirty();
    }); // showConfirmDialog
  },

  // === ドロップダウン列の選択肢編集 ===

  _editDropdownOptions(colId) {
    const customCols = this._getCustomColumns();
    const colDef = customCols.find(c => c.id === colId);
    if (!colDef || colDef.type !== 'select') return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" style="min-width:400px;max-width:500px;">
      <h3>${esc(colDef.label)} — 選択肢を編集</h3>
      <div class="modal-body" style="min-height:200px;">
        <label>選択肢（改行区切り）</label>
        <textarea id="sn2-opt-edit" rows="10" style="width:100%;padding:6px;font-size:13px;"></textarea>
      </div>
      <div class="btn-row">
        <button class="btn" id="sn2-opt-cancel">キャンセル</button>
        <button class="primary" id="sn2-opt-ok">保存</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#sn2-opt-edit');
    textarea.value = (colDef.options || []).join('\n');
    textarea.focus();
    overlay.querySelector('#sn2-opt-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#sn2-opt-ok').addEventListener('click', () => {
      this._pushUndo('選択肢編集');
      colDef.options = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
      this._render();
      this._markDirty();
      overlay.remove();
    });
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
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
    positionPopup(popup, anchorEl.getBoundingClientRect());
    const input = popup.querySelector('#sn2-unit-input');
    input.focus();
    input.select();
    const close = () => {
      popup.remove();
      document.removeEventListener('pointerdown', closeHandler);
    };
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
    const closeHandler = (ev) => { if (!popup.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 0);
  },

  // === カスタム列追加（末尾に追加、既存メソッド） ===

  _addCustomColumn() {
    if (!this.doc) return;
    if (!this.doc.editor.customColumns) this.doc.editor.customColumns = [];
    const id = 'col-' + Date.now();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" style="min-width:480px;max-width:640px;">
      <h3>列を追加</h3>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:8px;min-height:300px;">
        <div class="field"><label>列名</label><input type="text" id="sn2-col-name" value="新しい列" style="width:100%;padding:4px 6px;"></div>
        <div class="field"><label>タイプ</label>
          <select id="sn2-col-type" style="width:100%;padding:4px 6px;">
            <option value="text">テキスト</option>
            <option value="number">数値</option>
            <option value="select">ドロップダウン</option>
          </select>
        </div>
        <div class="field" id="sn2-col-options-wrap" style="display:none;">
          <label>選択肢（改行区切り）</label>
          <textarea id="sn2-col-options" rows="8" style="width:100%;padding:4px 6px;"></textarea>
        </div>
        <div class="field"><label>幅(px)</label><input type="number" id="sn2-col-width" value="80" min="20" max="400" style="width:80px;padding:4px 6px;"></div>
      </div>
      <div class="btn-row">
        <button class="btn" id="sn2-col-cancel">キャンセル</button>
        <button class="primary" id="sn2-col-ok">追加</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const typeSel = overlay.querySelector('#sn2-col-type');
    const optWrap = overlay.querySelector('#sn2-col-options-wrap');
    typeSel.addEventListener('change', () => { optWrap.style.display = typeSel.value === 'select' ? '' : 'none'; });
    overlay.querySelector('#sn2-col-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#sn2-col-ok').addEventListener('click', () => {
      const label = overlay.querySelector('#sn2-col-name').value.trim() || '列';
      const type = typeSel.value;
      const width = Number(overlay.querySelector('#sn2-col-width').value) || 80;
      const options = type === 'select'
        ? overlay.querySelector('#sn2-col-options').value.split('\n').map(s => s.trim()).filter(Boolean)
        : undefined;
      this._pushUndo('列追加');
      this.doc.editor.customColumns.push({ id, label, type, width, options });
      this._render();
      this._markDirty();
      overlay.remove();
    });
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  },

});
