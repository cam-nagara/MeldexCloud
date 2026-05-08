/* gb-scriptnote-detail.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-scriptnote-detail.part01.js */
/* gb-scriptnote-detail.js: 台本エディタ v2 — 詳細パネル（タイプ管理）
   ScriptNoteEditor.prototype を拡張する */

Object.assign(ScriptNoteEditor.prototype, {

  renderDetailPanel(container) {
    if (!container || !this.doc) return;
    this._ensureDefaultChara();
    this._detailSelection = this._detailSelection || new Set();
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'sn2-detail';
    const e = typeof esc === 'function' ? esc : (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const mkBtn = (label, title, onClick) => {
      const b = document.createElement('button');
      b.className = 'sn2-detail-add-btn';
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };

    // ツールバー（タイトルバーなし、適用・DB読込を右寄せ）
    const toolbar = document.createElement('div');
    toolbar.className = 'sn2-detail-toolbar';
    toolbar.appendChild(mkBtn('＋追加', '新規タイプ追加', () => {
      this._pushUndo('タイプ追加');
      const newChara = { name: '新しいキャラ' };
      this._assignAutoColor(newChara);
      this._applyColumnAllRules(newChara);
      // デフォルトタイプの直前に挿入（末尾固定の不変条件を維持）
      const defIdx = this.doc.characters.findIndex(c => c.isDefault);
      if (defIdx >= 0) this.doc.characters.splice(defIdx, 0, newChara);
      else this.doc.characters.push(newChara);
      this._detailSelection.clear();
      this._markDirty();
      this.renderDetailPanel(container);
    }));
    toolbar.appendChild(mkBtn('複製', '選択中を複製', () => {
      if (!this._detailSelection.size) return;
      // デフォルトタイプは複製対象外
      const sorted = Array.from(this._detailSelection)
        .filter(i => !this.doc.characters[i]?.isDefault)
        .sort((a, b) => a - b);
      if (!sorted.length) return;
      this._pushUndo('タイプ複製');
      let offset = 0;
      sorted.forEach(i => {
        const src = this.doc.characters[i + offset];
        if (src) {
          const dup = this._cloneChara(src);
          dup.name = src.name + '（コピー）';
          this.doc.characters.splice(i + offset + 1, 0, dup);
          offset++;
        }
      });
      this._detailSelection.clear();
      this._markDirty();
      this.renderDetailPanel(container);
    }));
    toolbar.appendChild(mkBtn('削除', '選択中を削除', () => {
      if (!this._detailSelection.size) return;
      // デフォルトタイプは削除対象外
      const targetIdxs = Array.from(this._detailSelection).filter(i => !this.doc.characters[i]?.isDefault);
      if (!targetIdxs.length) return;
      const names = targetIdxs.map(i => this.doc.characters[i]?.name).filter(Boolean);
      showConfirmDialog(`${targetIdxs.length}件のタイプを削除しますか？\n${names.join(', ')}`, () => {
        this._pushUndo('タイプ削除');
        this._clearRolesInRows(names);
        targetIdxs.sort((a, b) => b - a).forEach(i => this.doc.characters.splice(i, 1));
        this._detailSelection.clear();
        this._markDirty();
        this.renderDetailPanel(container);
      });
    }));
    // 全選択ボタン
    const selectAllBtn = mkBtn('全選択', 'すべてのタイプを選択', () => {
      this.doc.characters.forEach((_, i) => this._detailSelection.add(i));
      container.querySelectorAll('.sn2-detail-item').forEach(el => {
        el.classList.add('selected');
        const cb = el.querySelector('.sn2-detail-check');
        if (cb) cb.checked = true;
      });
      this._updateBulkBar(toolbar);
    });
    toolbar.appendChild(selectAllBtn);
    // 全解除ボタン
    const deselectBtn = mkBtn('全解除', '選択をすべて解除', () => {
      this._detailSelection.clear();
      this._detailLastClickIdx = -1;
      container.querySelectorAll('.sn2-detail-item').forEach(el => {
        el.classList.remove('selected');
        const cb = el.querySelector('.sn2-detail-check');
        if (cb) cb.checked = false;
      });
      this._updateBulkBar(toolbar);
    });
    deselectBtn.className += ' sn2-detail-bulk-btn';
    toolbar.appendChild(deselectBtn);
    // 一括操作（複数選択時のみ表示）— 背景色・文字色ボタン削除、一括設定のみ残す
    const bulkSep = document.createElement('span');
    bulkSep.className = 'sn2-detail-bulk-sep';
    bulkSep.textContent = '|';
    toolbar.appendChild(bulkSep);
    const bulkCount = document.createElement('span');
    bulkCount.className = 'sn2-detail-bulk-count';
    bulkCount.textContent = '';
    toolbar.appendChild(bulkCount);
    const bulkAllBtn = mkBtn('一括設定…', '全プロパティ一括変更', () => this._showBulkEditPopup(container));
    bulkAllBtn.className += ' sn2-detail-bulk-btn';
    toolbar.appendChild(bulkAllBtn);
    // 右寄せスペーサー + DB読込
    const spacer = document.createElement('span');
    spacer.className = 'sn2-detail-toolbar-spacer';
    toolbar.appendChild(spacer);
    toolbar.appendChild(mkBtn('DB読込', 'DBからキャラ読み込み', () => this._showDbImportModal(container)));
    this._detailBulkBar = toolbar;

    // キャラクターリスト（列×タイプ表形式）
    const list = document.createElement('div');
    list.className = 'sn2-detail-list';
    this._detailLastClickIdx = -1;
    // 列定義（標準列 + カスタム列）
    const detailCols = [
      { id: '_gutter', label: '大区切り' },
      { id: '_gutter2', label: '小区切り' },
      { id: '_role', label: 'タイプ' },
      { id: '_text', label: 'テキスト' },
    ];
    (this.doc.editor?.customColumns || []).forEach(col => {
      detailCols.push({ id: col.id, label: col.label || col.id });
    });
    // テーブル構築
    const table = document.createElement('table');
    table.className = 'sn2-detail-table';
    // colgroup で列幅を明示指定
    const colgroup = document.createElement('colgroup');
    const addCol = (w) => { const c = document.createElement('col'); c.style.width = w; colgroup.appendChild(c); };
    addCol('36px'); // チェック+ハンドル
    detailCols.forEach(col => {
      if (col.id === '_role') addCol('100px');
      else if (col.id === '_text') addCol('90px');
      else addCol('54px');
    });
    addCol('80px'); // オプション
    table.appendChild(colgroup);
    // ヘッダー行
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    const thCtrl = document.createElement('th');
    thCtrl.className = 'sn2-detail-th-ctrl';
    hRow.appendChild(thCtrl);
    detailCols.forEach(col => {
      const th = document.createElement('th');
      th.className = 'sn2-detail-th-col';
      th.textContent = col.label;
      th.title = `${col.label}列のスタイルを一括設定`;
      th.addEventListener('click', () => this._showColBulkPopup(th, col.id, container));
      hRow.appendChild(th);
    });
    const thInfo = document.createElement('th');
    thInfo.className = 'sn2-detail-th-info';
    thInfo.textContent = 'オプション';
    hRow.appendChild(thInfo);
    thead.appendChild(hRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    this.doc.characters.forEach((chara, i) => {
      tbody.appendChild(this._buildDetailItem(chara, i, container, detailCols));
    });
    table.appendChild(tbody);
    list.appendChild(table);
    // ツールバー（＋追加等のボタンバー）をリスト内のテーブル直後に配置（スクロールに追従）
    list.appendChild(toolbar);
    wrap.appendChild(list);

    container.appendChild(wrap);
    this._setupDetailDragDrop(list, container);
    this._updateBulkBar(toolbar);
  },

  _buildDetailItem(chara, idx, panelContainer, detailCols) {
    const isDefaultRow = !!chara.isDefault;
    const item = document.createElement('tr');
    item.className = 'sn2-detail-item' + (this._detailSelection?.has(idx) ? ' selected' : '') + (isDefaultRow ? ' sn2-detail-default' : '');
    item.dataset.idx = idx;
    item.dataset.kind = isDefaultRow
      ? 'blank'
      : (chara.isSummary ? 'summary' : (chara.isBreak ? 'break' : (['dialogue', 'action', 'heading'].includes(chara.kind) ? chara.kind : 'dialogue')));
    item.draggable = !isDefaultRow;

    // チェックボックス + ドラッグハンドル セル（横並び）— デフォルト行はチェックボックスのみ（ハンドルなし）
    const ctrlTd = document.createElement('td');
    ctrlTd.className = 'sn2-detail-td-ctrl';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'sn2-detail-check';
    check.checked = this._detailSelection?.has(idx) || false;
    check.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ev.shiftKey && this._detailLastClickIdx >= 0) {
        const from = Math.min(this._detailLastClickIdx, idx);
        const to = Math.max(this._detailLastClickIdx, idx);
        const adding = check.checked;
        for (let i = from; i <= to; i++) {
          if (adding) this._detailSelection.add(i); else this._detailSelection.delete(i);
        }
      } else {
        if (check.checked) this._detailSelection.add(idx); else this._detailSelection.delete(idx);
      }
      this._detailLastClickIdx = idx;
      item.closest('.sn2-detail-list')?.querySelectorAll('.sn2-detail-item').forEach(el => {
        const i = Number(el.dataset.idx);
        const sel = this._detailSelection.has(i);
        el.classList.toggle('selected', sel);
        const cb = el.querySelector('.sn2-detail-check');
        if (cb) cb.checked = sel;
      });
      if (this._detailBulkBar) this._updateBulkBar(this._detailBulkBar);
    });
    ctrlTd.appendChild(check);
    if (!isDefaultRow) {
      const handle = document.createElement('span');
      handle.className = 'sn2-detail-handle-inline';
      handle.textContent = '⠿';
      ctrlTd.appendChild(handle);
    }
    item.appendChild(ctrlTd);

    // 各列のプレビューセル
    const previewCells = [];
    const CELL_LABELS = { _gutter: 'p01', _gutter2: 'コマ01', _role: null, _text: 'テキスト列' };
    const _pageBg = 'var(--sn2-page-bg, var(--content-bg, var(--bg)))';
    // 動的スタイルを一括適用するヘルパー (背景・文字・太字・斜体・サイズ)
    const applyDynStyle = (el, props) => { Object.assign(el.style, props); };
    (detailCols || []).forEach(col => {
      const td = document.createElement('td');
      td.className = 'sn2-detail-td-cell';
      const ec = this._resolveCharaColors(chara, col.id);
      const cs = this._getColStyle(chara, col.id);
      const isText = col.id === '_text';
      // 色: 列別スタイル → resolveCharaColors(autoColor対応) → ページ背景色
      const rawBg = cs.bgColor || ec.bgColor || '';
      const bgIsTransparent = !rawBg || rawBg === 'transparent' || rawBg === 'rgba(0,0,0,0)';
      const bgDisplay = bgIsTransparent ? _pageBg : rawBg;
      const fgDisplay = cs.textColor || ec.textColor || 'var(--fg)';
      // フォント: _text列と_role列はcharaフォールバック（エディタの挙動と一致）
      const isRole = col.id === '_role';
      const fwActive = ((isText || isRole) ? (cs.fontWeight || chara.fontWeight) : cs.fontWeight) === 'bold';
      const fstActive = ((isText || isRole) ? (cs.fontStyle || chara.fontStyle) : cs.fontStyle) === 'italic';
      const effFz = (isText || isRole) ? (cs.fontSize || chara.fontSize) : cs.fontSize;
      const effFont = (isText || isRole) ? (cs.fontFamily || chara.fontFamily) : cs.fontFamily;
      const effStrokeColor = (isText || isRole) ? (cs.textStrokeColor || chara.textStrokeColor) : cs.textStrokeColor;
      const effStrokeWidth = (isText || isRole) ? (cs.textStrokeWidth || chara.textStrokeWidth) : cs.textStrokeWidth;
      const effAccentColor = cs.accentColor || chara.accentColor || fgDisplay || 'var(--accent)';
      const dynStyle = {
        background: bgDisplay,
        color: fgDisplay,
        fontWeight: fwActive ? 'bold' : '',
        fontStyle: fstActive ? 'italic' : '',
        fontSize: effFz ? effFz + 'px' : '',
        fontFamily: effFont || '',
        webkitTextStrokeColor: effStrokeColor || '',
        webkitTextStrokeWidth: effStrokeWidth ? effStrokeWidth + 'px' : '',
        paintOrder: (effStrokeColor || effStrokeWidth) ? 'stroke fill' : '',
        boxShadow: cs.leftAccent ? `inset 3px 0 0 ${effAccentColor}` : '',
        textDecorationLine: cs.underline ? 'underline' : '',
        textDecorationColor: cs.underline ? effAccentColor : '',
      };

      if (col.id === '_role') {
        // タイプ列: インライン入力 + ホバー時「…」ボタン（デフォルト行は固定ラベル）
        if (isDefaultRow) {
          const labelDiv = document.createElement('div');
          labelDiv.className = 'sn2-detail-cell-label';
          labelDiv.textContent = '（デフォルト）';
          labelDiv.title = '役割が空の行に適用されるデフォルトスタイル';
          applyDynStyle(labelDiv, dynStyle);
          td.appendChild(labelDiv);
          const fmtBtn = document.createElement('button');
          fmtBtn.type = 'button'; fmtBtn.textContent = '…'; fmtBtn.title = '書式設定';
          fmtBtn.className = 'sn2-detail-cell-fmt-btn';
          fmtBtn.addEventListener('click', (e) => { e.stopPropagation(); this._showCellStylePopup(td, chara, col.id, panelContainer); });
          td.appendChild(fmtBtn);
          td.addEventListener('click', () => this._showCellStylePopup(td, chara, col.id, panelContainer));
          previewCells.push({ td, el: labelDiv, colId: col.id, isInput: false, isDefaultLabel: true });
        } else {
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.value = chara.name || '';
          nameInput.placeholder = 'タイプ名';
          nameInput.className = 'sn2-detail-cell-input';
          applyDynStyle(nameInput, dynStyle);
          nameInput.addEventListener('change', () => {
            this._pushUndo('タイプ名変更');
            const oldName = chara.name;
            chara.name = nameInput.value.trim();
            this._renameRoleInRows(oldName, chara.name);
            this._markDirty();
          });
          nameInput.addEventListener('click', (e) => e.stopPropagation());
          nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const row = td.closest('.sn2-detail-item');
              const sibling = e.key === 'ArrowUp' ? row?.previousElementSibling : row?.nextElementSibling;
              if (sibling) {
                const nextInput = sibling.querySelector('input[type="text"][placeholder="タイプ名"]');
                if (nextInput) { nameInput.dispatchEvent(new Event('change')); nextInput.focus(); nextInput.select(); }
              }
            }
          });
          td.appendChild(nameInput);
          // ホバー時に表示する「…」ボタン
          const fmtBtn = document.createElement('button');
          fmtBtn.type = 'button'; fmtBtn.textContent = '…'; fmtBtn.title = '書式設定';
          fmtBtn.className = 'sn2-detail-cell-fmt-btn';
          fmtBtn.addEventListener('click', (e) => { e.stopPropagation(); this._showCellStylePopup(td, chara, col.id, panelContainer); });
          td.appendChild(fmtBtn);
          previewCells.push({ td, el: nameInput, colId: col.id, isInput: true });
        }
      } else {
        const cellLabel = CELL_LABELS[col.id] !== undefined ? CELL_LABELS[col.id] : (col.label || col.id);
        // _text列: textStyle → charaフォールバック（エディタと一致）
        // _gutter/_gutter2: 列スタイルのみ（エディタではtextBefore/After/Align未使用）
        const ta = isText ? (cs.textAlign || chara.textAlign || 'center') : (cs.textAlign || 'center');
        const va = isText ? (cs.textValign || chara.textValign || '') : (cs.textValign || '');
        const tb = isText ? (cs.textBefore ?? chara.textBefore ?? '') : '';
        const taf = isText ? (cs.textAfter ?? chara.textAfter ?? '') : '';
        const toVal = isText ? (cs.textOverflow || chara.textOverflow || '') : (cs.textOverflow || '');
        const preview = document.createElement('div');
        preview.className = 'sn2-detail-cell-preview';
        const previewProps = { ...dynStyle };
        if (va) {
          previewProps.display = 'flex';
          previewProps.alignItems = va === 'top' ? 'flex-start' : va === 'bottom' ? 'flex-end' : 'center';
          previewProps.justifyContent = ta === 'left' ? 'flex-start' : ta === 'right' ? 'flex-end' : 'center';
        } else {
          previewProps.textAlign = ta;
          previewProps.lineHeight = '24px';
        }
        previewProps.whiteSpace = toVal === 'wrap' ? 'normal' : 'nowrap';
        applyDynStyle(preview, previewProps);
        preview.textContent = tb + (cellLabel || '') + taf;
        preview.title = `${chara.name || '見本'} - ${col.label}`;
        td.appendChild(preview);
        td.addEventListener('click', () => this._showCellStylePopup(td, chara, col.id, panelContainer));
        previewCells.push({ td, el: preview, colId: col.id, isInput: false });
      }
      item.appendChild(td);
    });

    // オプション設定セル — デフォルト行は空セル
    const infoTd = document.createElement('td');
    infoTd.className = 'sn2-detail-td-info';
    if (!isDefaultRow) {
      const optBtn = document.createElement('button');
      optBtn.className = 'gb-fmt-btn sn2-detail-opt-btn';
      optBtn.type = 'button';
      optBtn.textContent = 'オプション';
      optBtn.title = 'オプション設定';
      optBtn.addEventListener('click', () => this._showRoleOptionsPopup(optBtn, chara, panelContainer));
      const infoWrap = document.createElement('div');
      infoWrap.className = 'sn2-detail-opt-wrap';
      infoWrap.append(optBtn);
      infoTd.appendChild(infoWrap);
    }
    item.appendChild(infoTd);

    // applyPreview参照を保持
    item._applyPreview = () => {
      previewCells.forEach(pc => {
        const ec = this._resolveCharaColors(chara, pc.colId);
        const cs = this._getColStyle(chara, pc.colId);
        const isText = pc.colId === '_text';
        const isRole = pc.colId === '_role';
        // 色: 列別 → resolveCharaColors → デフォルト
        const rawBg = cs.bgColor || ec.bgColor || '';
        const bgTrans = !rawBg || rawBg === 'transparent' || rawBg === 'rgba(0,0,0,0)';
        const bg = bgTrans ? _pageBg : rawBg;
        const fg = cs.textColor || ec.textColor || 'var(--fg)';
        // フォント: _text列と_role列はcharaフォールバック（エディタと一致）
        const fw = ((isText || isRole) ? (cs.fontWeight || chara.fontWeight) : cs.fontWeight) === 'bold' ? 'bold' : '';
        const fst = ((isText || isRole) ? (cs.fontStyle || chara.fontStyle) : cs.fontStyle) === 'italic' ? 'italic' : '';
        const fz = (isText || isRole) ? (cs.fontSize || chara.fontSize || '') : (cs.fontSize || '');
        const ff = (isText || isRole) ? (cs.fontFamily || chara.fontFamily || '') : (cs.fontFamily || '');
        const strokeColor = (isText || isRole) ? (cs.textStrokeColor || chara.textStrokeColor || '') : (cs.textStrokeColor || '');
        const strokeWidth = (isText || isRole) ? (cs.textStrokeWidth || chara.textStrokeWidth || '') : (cs.textStrokeWidth || '');
        const accentColor = cs.accentColor || chara.accentColor || fg || 'var(--accent)';
        const ta = isText ? (cs.textAlign || chara.textAlign || 'center') : (cs.textAlign || 'center');
        const va = isText ? (cs.textValign || chara.textValign || '') : (cs.textValign || '');
        const tb = isText ? (cs.textBefore ?? chara.textBefore ?? '') : '';
        const taf = isText ? (cs.textAfter ?? chara.textAfter ?? '') : '';
        const toVal = isText ? (cs.textOverflow || chara.textOverflow || '') : (cs.textOverflow || '');
        const nextProps = {
          background: bg, backgroundSize: '', backgroundPosition: '',
          color: fg,
          fontWeight: fw, fontStyle: fst,
          fontSize: fz ? fz + 'px' : '',
          fontFamily: ff || '',
          webkitTextStrokeColor: strokeColor || '',
          webkitTextStrokeWidth: strokeWidth ? strokeWidth + 'px' : '',
          paintOrder: (strokeColor || strokeWidth) ? 'stroke fill' : '',
          boxShadow: cs.leftAccent ? `inset 3px 0 0 ${accentColor}` : '',
          textDecorationLine: cs.underline ? 'underline' : '',
          textDecorationColor: cs.underline ? accentColor : '',
        };
        // テキスト前後・配置の反映（input以外）
        if (!pc.isInput) {
          if (va) {
            nextProps.display = 'flex';
            nextProps.alignItems = va === 'top' ? 'flex-start' : va === 'bottom' ? 'flex-end' : 'center';
            nextProps.justifyContent = ta === 'left' ? 'flex-start' : ta === 'right' ? 'flex-end' : 'center';
            nextProps.textAlign = '';
            nextProps.lineHeight = '';
          } else {
            nextProps.display = '';
            nextProps.alignItems = '';
            nextProps.justifyContent = '';
            nextProps.textAlign = ta;
            nextProps.lineHeight = '24px';
          }
          nextProps.whiteSpace = toVal === 'wrap' ? 'normal' : 'nowrap';
          if (!pc.isDefaultLabel) {
            const label = CELL_LABELS[pc.colId] !== undefined ? CELL_LABELS[pc.colId] : '';
            pc.el.textContent = tb + (label || '') + taf;
          }
        }
        Object.assign(pc.el.style, nextProps);
      });
    };

    return item;
  },

  _updateBulkBar(toolbar) {
    if (!toolbar) return;
    const count = this._detailSelection?.size || 0;
    const countEl = toolbar.querySelector('.sn2-detail-bulk-count');
    if (countEl) countEl.textContent = count > 0 ? `${count}件` : '';
    const hidden = count <= 0;
    const sep = toolbar.querySelector('.sn2-detail-bulk-sep');
    if (sep) sep.hidden = hidden;
    // 一括処理ボタンは複数選択時のみ表示
    toolbar.querySelectorAll('.sn2-detail-bulk-btn').forEach(btn => {
      btn.hidden = hidden;
    });
  },

  _bulkColorChange(prop, panelContainer) {
    // 一括色変更のトリガー元ボタンを探す
    const toolbar = this._detailBulkBar;
    const anchor = toolbar?.querySelector(`.sn2-detail-bulk-btn`) || toolbar;
    if (typeof openColorPalette === 'function' && anchor) {
      openColorPalette(anchor, '#4a90d9', (color) => {
        this._pushUndo('一括色変更');
        this._detailSelection.forEach(idx => {
          const chara = this.doc.characters[idx];
          if (chara) chara[prop] = color;
        });
        this._refreshRowStyles();
        this._markDirty();
        this.renderDetailPanel(panelContainer);
      });
    } else {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = '#4a90d9';
      input.className = 'sn2-hidden-color-input';
      document.body.appendChild(input);
      const cleanup = () => { if (input.parentNode) input.remove(); };
      input.addEventListener('input', () => {
        this._pushUndo('一括色変更');
        this._detailSelection.forEach(idx => {
          const chara = this.doc.characters[idx];
          if (chara) chara[prop] = input.value;
        });
        this._refreshRowStyles();
        this._markDirty();
      });
      input.addEventListener('change', () => { cleanup(); this.renderDetailPanel(panelContainer); });
      input.addEventListener('blur', () => setTimeout(cleanup, 100));
      input.click();
    }
  },

  _showBulkEditPopup(panelContainer) {
    if (!this._detailSelection?.size) return;
    const toolbar = this._detailBulkBar;
    const anchor = toolbar?.querySelector('.sn2-detail-bulk-btn:last-child') || toolbar;
    document.querySelectorAll('.gb-fmt-popup--bulk-edit').forEach(el => el.remove());
    const popup = document.createElement('div');
    popup.className = 'gb-fmt-popup gb-fmt-popup--bulk-edit';
    const e = typeof esc === 'function' ? esc : (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    popup.innerHTML = `
      <div class="sn2-bulk-title">一括設定（${this._detailSelection.size}件）</div>
      <div class="sn2-bulk-body">
        <div class="sn2-bulk-row">
          <label><input type="checkbox" data-bulk-check="bgColor"> 背景色</label>
          <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg" data-bulk-color="bgColor"></button>
        </div>
        <div class="sn2-bulk-row">
          <label><input type="checkbox" data-bulk-check="textColor"> 文字色</label>
          <button type="button" class="gb-fmt-swatch gb-fmt-swatch-fg" data-bulk-color="textColor">T</button>
        </div>
        <div class="sn2-bulk-row">
          <label><input type="checkbox" data-bulk-check="fontWeight"> 太字</label>
          <select class="sn2-bulk-sel" data-bulk-val="fontWeight">
            <option value="">通常</option><option value="bold">太字</option>
          </select>
        </div>
        <div class="sn2-bulk-row">
          <label><input type="checkbox" data-bulk-check="fontStyle"> 斜体</label>
          <select class="sn2-bulk-sel" data-bulk-val="fontStyle">
            <option value="">通常</option><option value="italic">斜体</option>
          </select>
        </div>
        <div class="sn2-bulk-row">
          <label><input type="checkbox" data-bulk-check="fontSize"> サイズ</label>
          <input type="number" class="sn2-bulk-input-num" data-bulk-val="fontSize" value="" placeholder="14" min="8" max="48">
          <span class="sn2-role-opts-unit">px</span>
        </div>
        <div class="sn2-bulk-row">
          <label><input type="checkbox" data-bulk-check="kind"> 種別</label>
          <select class="sn2-bulk-sel" data-bulk-val="kind">
            <option value="dialogue">台詞</option><option value="action">ト書き</option><option value="heading">見出し</option><option value="break">区切り</option><option value="summary">プロット</option>
          </select>
        </div>
        <div class="sn2-bulk-row">
          <label><input type="checkbox" data-bulk-check="textBefore"> テキスト前</label>
          <input type="text" class="sn2-bulk-input-text" data-bulk-val="textBefore" value="" placeholder="例: 「">
        </div>
        <div class="sn2-bulk-row">
          <label><input type="checkbox" data-bulk-check="textAfter"> テキスト後</label>
          <input type="text" class="sn2-bulk-input-text" data-bulk-val="textAfter" value="" placeholder="例: 」">
        </div>
        <div class="sn2-bulk-section-divider">
          <div class="sn2-bulk-section-title">テキスト列書式</div>
          <div class="sn2-bulk-row">
            <label><input type="checkbox" data-bulk-check="ts_bgColor"> 背景</label>
            <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg" data-bulk-color="ts_bgColor"></button>
            <label><input type="checkbox" data-bulk-check="ts_textColor"> 文字</label>
            <button type="button" class="gb-fmt-swatch gb-fmt-swatch-fg" data-bulk-color="ts_textColor">T</button>
            <label><input type="checkbox" data-bulk-check="ts_fontSize"> サイズ</label>
            <input type="number" class="sn2-bulk-input-num sn2-bulk-input-num--sm" data-bulk-val="ts_fontSize" value="" placeholder="14" min="8" max="48">
          </div>
        </div>
        <div class="sn2-bulk-apply-row">
          <button type="button" class="sn2-detail-add-btn" data-bulk-apply>適用</button>
        </div>
      </div>`;
    let closeHandler = null;
    const closePopup = () => {
      popup.remove();
      if (closeHandler) {
        document.removeEventListener('pointerdown', closeHandler);
        closeHandler = null;
      }
    };
    const bulkValues = {};
    // カラーピッカー（直接openColorPaletteを使用。適用前なので_refreshRowStylesは呼ばない）
    popup.querySelectorAll('[data-bulk-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        const prop = btn.dataset.bulkColor;
        const cb = popup.querySelector(`[data-bulk-check="${prop}"]`);
        if (cb) cb.checked = true;
        if (typeof openColorPalette === 'function') {
          openColorPalette(btn, bulkValues[prop] || '', (color) => {
            bulkValues[prop] = color;
            if (prop === 'bgColor' || prop === 'ts_bgColor') Object.assign(btn.style, { background: color });
            if (prop === 'textColor' || prop === 'ts_textColor') Object.assign(btn.style, { color: color });
          });
        }
      });
    });
    // 適用ボタン
    popup.querySelector('[data-bulk-apply]')?.addEventListener('click', () => {
      this._pushUndo('一括設定適用');
      popup.querySelectorAll('[data-bulk-check]').forEach(cb => {
        if (!cb.checked) return;
        const prop = cb.dataset.bulkCheck;
        const colorBtn = popup.querySelector(`[data-bulk-color="${prop}"]`);
        const valEl = popup.querySelector(`[data-bulk-val="${prop}"]`);
        let val;
        if (colorBtn) {
          val = bulkValues[prop] || '';
        } else if (valEl) {
          val = valEl.type === 'number' ? (valEl.value ? Number(valEl.value) : null) : valEl.value;
        }
        // ts_*プレフィックスのプロパティはtextStyleに書き込む
        const isTs = prop.startsWith('ts_');
        const realProp = isTs ? prop.slice(3) : prop;
        this._detailSelection.forEach(idx => {
          const chara = this.doc.characters[idx];
          if (!chara) return;
          // デフォルトタイプは kind 変更のみ対象外（常に 'none' 固定）
          if (chara.isDefault && realProp === 'kind') return;
          if (isTs) {
            if (!chara.textStyle) chara.textStyle = {};
            chara.textStyle[realProp] = val;
          } else if (realProp === 'kind') {
            chara.kind = val;
            chara.isBreak = val === 'break';
            chara.isSummary = val === 'summary';
            this._calcCache = null;
          } else {
            chara[realProp] = val;
          }
        });
      });
      this._refreshRowStyles();
      this._markDirty();
      this._render(); // kind変更等をDOMに反映
      this.renderDetailPanel(panelContainer);
      closePopup();
    });
    document.body.appendChild(popup);
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(popup, {
        trigger: anchor,
        close: closePopup,
      });
    }
    if (typeof positionPopup === 'function') positionPopup(popup, anchor.getBoundingClientRect());
    else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
    setTimeout(() => {
      closeHandler = (ev) => {
        if (!popup.contains(ev.target) && !ev.target.closest?.('.gb-fmt-popup') && !ev.target.closest?.('.gb-palette-popup')) {
          closePopup();
        }
      };
      document.addEventListener('pointerdown', closeHandler);
    }, 0);
  },

  // DB読み込みモーダル
  async _showDbImportModal(panelContainer) {
    let overlay = null;
    try {
      const roots = await apiFetch('/outliner-roots');
      if (!Array.isArray(roots) || !roots.length) { showStatus('フォルダツリーがありません', true); return; }
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `<div class="modal sn2-db-import-modal">
        <h3>DBからキャラ読み込み</h3>
        <div class="modal-body sn2-db-import-body">
          <div id="sn2-db-tree" class="sn2-db-import-tree"></div>
        </div>
        <div id="sn2-db-selected" class="sn2-db-import-selected">選択: 0件</div>
        <div class="btn-row">
          <button class="btn" id="sn2-db-cancel">キャンセル</button>
          <button class="primary" id="sn2-db-ok">読み込み</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const treeHost = overlay.querySelector('#sn2-db-tree');
      const selectedNames = new Set();
      // DBツリーを構築（簡易版: 設定フォルダのキャラDBを探す）
      for (const root of roots) {
        const items = await apiFetch('/browse?path=' + encodeURIComponent(root.path) + '&all_files=true');
        const dbFolders = (items || []).filter(it => it.type === 'folder' || it.type === 'database');
        for (const folder of dbFolders) {
          const entries = await apiFetch('/browse?path=' + encodeURIComponent(folder.path) + '&all_files=true');
          const pages = (entries || []).filter(it => it.type === 'page' || it.type === 'entity');
          if (!pages.length) continue;
          const groupEl = document.createElement('div');
          groupEl.className = 'sn2-db-import-group';
          const groupLabel = document.createElement('div');
          groupLabel.className = 'sn2-db-import-group-label';
          groupLabel.textContent = folder.name || folder.path;
          groupEl.appendChild(groupLabel);
          pages.forEach(p => {
            const label = document.createElement('label');
            label.className = 'sn2-db-import-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.addEventListener('change', () => {
              if (cb.checked) selectedNames.add(p.name); else selectedNames.delete(p.name);
              overlay.querySelector('#sn2-db-selected').textContent = `選択: ${selectedNames.size}件`;
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(p.name || p.path));
            groupEl.appendChild(label);
          });
          treeHost.appendChild(groupEl);
        }
      }
      overlay.querySelector('#sn2-db-cancel').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#sn2-db-ok').addEventListener('click', () => {
        this._pushUndo('DBインポート');
        selectedNames.forEach(name => {
          if (!this.doc.characters.some(c => !c.isDefault && c.name === name)) {
            const newChara = { name };
            this._assignAutoColor(newChara);
            this._applyColumnAllRules(newChara);
            // デフォルトタイプの直前に挿入（末尾固定の不変条件を維持）
            const defIdx = this.doc.characters.findIndex(c => c.isDefault);
            if (defIdx >= 0) this.doc.characters.splice(defIdx, 0, newChara);
            else this.doc.characters.push(newChara);
          }
        });
        this._detailSelection?.clear();
        this._markDirty();
        this.renderDetailPanel(panelContainer);
        overlay.remove();
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    } catch (err) {
      if (overlay) overlay.remove();
      if (typeof showStatus === 'function') showStatus('DB読み込みエラー: ' + err.message, true);
    }
  },

  _showColorPicker(anchorEl, chara, prop, panelContainer) {
    const current = chara[prop] || '';
    // 透明背景のチェック柄
    const CHECKER = {
      backgroundImage: 'linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%)',
      backgroundSize: '6px 6px',
      backgroundPosition: '0 0,3px 3px',
    };
    if (typeof openColorPalette === 'function') {
      openColorPalette(anchorEl, current, (color) => {
        this._pushUndo('タイプ色変更');
        // 「透明」選択 = 色設定をクリア（他の設定にフォールバック）
        if (color === 'transparent') {
          delete chara[prop];
        } else {
          chara[prop] = color;
          // 手動で色を変更した場合はautoColorをクリア（手動設定を優先）
          if (chara.autoColor) {
            const act = chara.autoColorTarget || 'bg';
            const hasBg = typeof act === 'object' ? Object.values(act).some(v => v === 'bg' || v === 'both') : (act === 'bg' || act === 'both');
            const hasText = typeof act === 'object' ? Object.values(act).some(v => v === 'text' || v === 'both') : (act === 'text' || act === 'both');
            if (prop === 'bgColor' && hasBg) delete chara.autoColor;
            if (prop === 'textColor' && hasText) delete chara.autoColor;
          }
        }
        if (prop === 'bgColor') {
          if (chara[prop]) Object.assign(anchorEl.style, { background: chara[prop], backgroundSize: '', backgroundPosition: '' });
          else Object.assign(anchorEl.style, { background: '', ...CHECKER });
        }
        if (prop === 'textColor') {
          Object.assign(anchorEl.style, { color: chara[prop] || 'var(--fg)', textDecorationColor: chara[prop] || '' });
        }
        this._refreshRowStyles();
        this._markDirty();
        // 詳細パネルのプレビューも更新
        const item = anchorEl.closest('.sn2-detail-item');
        if (item?._applyPreview) item._applyPreview();
      });
    } else {
      // フォールバック: ネイティブカラーピッカー
      const input = document.createElement('input');
      input.type = 'color';
      input.value = current || '#4a90d9';
      input.className = 'sn2-hidden-color-input';
      document.body.appendChild(input);
      const cleanup = () => { if (input.parentNode) input.remove(); };
      input.addEventListener('input', () => {
        this._pushUndo('タイプ色変更');
        chara[prop] = input.value;
        if (prop === 'bgColor') Object.assign(anchorEl.style, { background: input.value });
        if (prop === 'textColor') Object.assign(anchorEl.style, { color: input.value });
        this._refreshRowStyles();
        this._markDirty();
      });
      input.addEventListener('change', cleanup);
      input.addEventListener('blur', () => setTimeout(cleanup, 100));
      input.click();
    }
  },

  // 列IDに対応するスタイルオブジェクトを取得/作成
  _getColStyle(chara, colId) {
    if (colId === '_text') { if (!chara.textStyle) chara.textStyle = {}; return chara.textStyle; }
    if (colId === '_gutter') { if (!chara.gutterStyle) chara.gutterStyle = {}; return chara.gutterStyle; }
    if (colId === '_gutter2') { if (!chara.gutter2Style) chara.gutter2Style = {}; return chara.gutter2Style; }
    if (colId === '_role') { if (!chara.roleStyle) chara.roleStyle = {}; return chara.roleStyle; }
    // カスタム列
    if (!chara.customStyles) chara.customStyles = {};
    if (!chara.customStyles[colId]) chara.customStyles[colId] = {};
    return chara.customStyles[colId];
  },

  // セルスタイルポップアップ（列別スタイル編集）— openFormatPopup 経由
  _showCellStylePopup(anchorEl, chara, colId, panelContainer) {
    if (typeof openFormatPopup !== 'function') return;
    const style = this._getColStyle(chara, colId);
    const isTextCol = colId === '_text';
    const isRoleCol = colId === '_role';
    const needsLegacySync = isTextCol || isRoleCol;
    const refreshItem = () => { const item = anchorEl.closest('.sn2-detail-item'); if (item?._applyPreview) item._applyPreview(); };
    const ec = this._resolveCharaColors(chara, colId) || {};
    const pick = (primary, fallback) => (primary != null && primary !== '' ? primary : fallback);
    const values = {
      // bgColor: 背景色は計画書 §2-2「未設定時はチェック柄表示」方針に従い fallback なし
      bgColor: style.bgColor || '',
      // textColor: T アイコンの色はタイプ色（ec）で表示するため fallback あり
      textColor: style.textColor || ec.textColor || '',
      fontWeight: needsLegacySync ? pick(style.fontWeight, chara.fontWeight || '') : (style.fontWeight || ''),
      fontStyle: needsLegacySync ? pick(style.fontStyle, chara.fontStyle || '') : (style.fontStyle || ''),
      fontSize: needsLegacySync ? pick(style.fontSize, chara.fontSize || '') : (style.fontSize || ''),
      fontFamily: needsLegacySync ? pick(style.fontFamily, chara.fontFamily || '') : (style.fontFamily || ''),
      textStrokeColor: needsLegacySync ? pick(style.textStrokeColor, chara.textStrokeColor || '') : (style.textStrokeColor || ''),
      textStrokeWidth: needsLegacySync ? pick(style.textStrokeWidth, chara.textStrokeWidth || '') : (style.textStrokeWidth || ''),
      leftAccent: !!style.leftAccent,
      underline: !!style.underline,
      accentColor: style.accentColor || chara.accentColor || '',
      textBefore: isTextCol ? (style.textBefore ?? chara.textBefore ?? '') : (style.textBefore ?? ''),
      textAfter: isTextCol ? (style.textAfter ?? chara.textAfter ?? '') : (style.textAfter ?? ''),
      textAlign: isTextCol ? (style.textAlign || chara.textAlign || '') : (style.textAlign ?? ''),
      textValign: isTextCol ? (style.textValign || chara.textValign || '') : (style.textValign ?? ''),
      textOverflow: isTextCol ? (style.textOverflow || chara.textOverflow || '') : (style.textOverflow ?? ''),
    };
    const clearAutoColorFor = (prop) => {
      if (!isRoleCol || !chara.autoColor) return;
      const act = chara.autoColorTarget || 'none';
      const actValues = typeof act === 'object' ? Object.values(act) : [act];
      const hasBg = actValues.some((v) => v === 'bg' || v === 'both');
      const hasText = actValues.some((v) => v === 'text' || v === 'both');
      if (prop === 'bgColor' && hasBg) delete chara.autoColor;
      if (prop === 'textColor' && hasText) delete chara.autoColor;
    };
    const UNDO_LABELS = {
      bgColor: 'タイプ色変更', textColor: 'タイプ色変更',
      fontWeight: 'タイプ書式変更', fontStyle: 'タイプ書式変更',
      fontSize: 'タイプサイズ変更', fontFamily: 'タイプフォント変更',
      textStrokeColor: 'タイプ装飾変更', textStrokeWidth: 'タイプ装飾変更',
      leftAccent: 'タイプ装飾変更', underline: 'タイプ装飾変更', accentColor: 'タイプ装飾変更',
      textBefore: 'タイプ設定変更', textAfter: 'タイプ設定変更',
      textAlign: 'タイプ配置変更', textValign: 'タイプ配置変更', textOverflow: 'タイプ配置変更',
    };
    openFormatPopup(anchorEl, {
      values,
      className: 'gb-fmt-popup--cell-style',
      onChange: (prop, value) => {
        this._pushUndo(UNDO_LABELS[prop] || 'タイプ書式変更');
        if (prop === 'bgColor' || prop === 'textColor') {
          if (value === '' || value == null) delete style[prop];
          else style[prop] = value;
          clearAutoColorFor(prop);
        } else if (prop === 'fontWeight' || prop === 'fontStyle') {
          if (!value) {
            delete style[prop];
            if (needsLegacySync) delete chara[prop];
          } else {
            style[prop] = value;
          }
        } else if (prop === 'fontSize') {
          if (value == null) {
            style.fontSize = null;
            if (needsLegacySync) chara.fontSize = null;
          } else {
            style.fontSize = value;
          }
        } else if (prop === 'fontFamily') {
          if (!value) {
            delete style.fontFamily;
            if (needsLegacySync) delete chara.fontFamily;
          } else {
            style.fontFamily = value;
          }
        } else if (prop === 'textStrokeWidth') {
          if (value == null) {
            delete style.textStrokeWidth;
            if (needsLegacySync) delete chara.textStrokeWidth;
          } else {
            style.textStrokeWidth = value;
          }
        } else if (prop === 'textStrokeColor' || prop === 'accentColor') {
          if (value === '' || value == null) delete style[prop];
          else style[prop] = value;
        } else if (prop === 'leftAccent' || prop === 'underline') {
          if (value) style[prop] = true;
          else delete style[prop];
        } else {
          style[prop] = value;
        }
        const needRender = (prop === 'textAlign' || prop === 'textValign' || prop === 'textOverflow');
        if (needRender) this._render();
        else this._refreshRowStyles();
        this._markDirty();
        refreshItem();
      },
      onReset: () => {
        this._pushUndo('書式リセット');
        ['bgColor','textColor','fontWeight','fontStyle','fontSize','fontFamily','textStrokeColor','textStrokeWidth','leftAccent','underline','accentColor','textBefore','textAfter','textAlign','textValign','textOverflow'].forEach((p) => delete style[p]);
        if (needsLegacySync) {
          ['fontWeight', 'fontStyle', 'fontSize', 'fontFamily', 'textStrokeColor', 'textStrokeWidth'].forEach((p) => { delete chara[p]; });
        }
        this._reapplyAutoColor(chara);
        this._refreshRowStyles();
        this._render();
        this._markDirty();
        refreshItem();
      },
    });
  },

/* Source chunk: gb-scriptnote-detail.part02.js */
  // 列ヘッダー一括設定ポップアップ — openFormatPopup 経由
  _showColBulkPopup(anchorEl, colId, panelContainer) {
    if (typeof openFormatPopup !== 'function') return;
    if (!this.doc.editor) this.doc.editor = {};
    if (!this.doc.editor.columnAllRules) this.doc.editor.columnAllRules = {};
    let applyAll = !!this.doc.editor.columnAllRules[colId];
    const rule0 = this.doc.editor.columnAllRules[colId] || {};
    const getTargets = () => {
      if (applyAll) return this.doc.characters.map((_, i) => i);
      return this._detailSelection?.size ? [...this._detailSelection] : this.doc.characters.map((_, i) => i);
    };
    const applyChanges = (changes, opts = {}) => {
      this._pushUndo('タイプ一括変更');
      const targets = getTargets();
      targets.forEach((i) => {
        const c = this.doc.characters[i];
        if (!c) return;
        const s = this._getColStyle(c, colId);
        Object.entries(changes).forEach(([prop, val]) => {
          if (val === '' || val === null || val === undefined) delete s[prop];
          else s[prop] = val;
        });
      });
      if (applyAll) {
        const rule = this.doc.editor.columnAllRules[colId] = this.doc.editor.columnAllRules[colId] || {};
        Object.entries(changes).forEach(([prop, val]) => {
          if (val === '' || val === null || val === undefined) delete rule[prop];
          else rule[prop] = val;
        });
      }
      if (opts.fullRender) this._render();
      else this._refreshRowStyles();
      this._markDirty();
      this.renderDetailPanel(panelContainer);
    };
    const FULL_RENDER_PROPS = new Set(['textBefore', 'textAfter', 'textAlign', 'textValign', 'textOverflow']);
    openFormatPopup(anchorEl, {
      values: {
        bgColor: rule0.bgColor || '',
        textColor: rule0.textColor || '',
        fontWeight: rule0.fontWeight || '',
        fontStyle: rule0.fontStyle || '',
        fontSize: rule0.fontSize || '',
        fontFamily: rule0.fontFamily || '',
        textStrokeColor: rule0.textStrokeColor || '',
        textStrokeWidth: rule0.textStrokeWidth || '',
        leftAccent: !!rule0.leftAccent,
        underline: !!rule0.underline,
        accentColor: rule0.accentColor || '',
        textBefore: rule0.textBefore || '',
        textAfter: rule0.textAfter || '',
        textAlign: rule0.textAlign || '',
        textValign: rule0.textValign || '',
        textOverflow: rule0.textOverflow || '',
      },
      className: 'gb-fmt-popup--colbulk',
      bulk: {
        enabled: applyAll,
        label: '全行に適用（新規行にも反映）',
        onToggle: (v) => {
          this._pushUndo(v ? '全行適用ON' : '全行適用OFF');
          applyAll = v;
          if (applyAll) {
            if (!this.doc.editor.columnAllRules[colId]) this.doc.editor.columnAllRules[colId] = {};
          } else {
            delete this.doc.editor.columnAllRules[colId];
          }
          this._markDirty();
        },
      },
      onChange: (prop, value) => {
        const change = {};
        change[prop] = value === null || value === undefined ? '' : value;
        applyChanges(change, FULL_RENDER_PROPS.has(prop) ? { fullRender: true } : {});
      },
      onReset: () => {
        this._pushUndo('一括書式リセット');
        const targets = getTargets();
        targets.forEach((i) => {
          const c = this.doc.characters[i];
          if (!c) return;
          const s = this._getColStyle(c, colId);
          ['bgColor','textColor','fontWeight','fontStyle','fontSize','fontFamily','textStrokeColor','textStrokeWidth','leftAccent','underline','accentColor','textBefore','textAfter','textAlign','textValign','textOverflow'].forEach((p) => delete s[p]);
          this._reapplyAutoColor(c);
        });
        if (applyAll && this.doc.editor.columnAllRules[colId]) {
          delete this.doc.editor.columnAllRules[colId];
        }
        this._refreshRowStyles();
        this._render();
        this._markDirty();
        this.renderDetailPanel(panelContainer);
      },
    });
  },

  _showRoleOptionsPopup(anchorEl, chara, panelContainer) {
    document.querySelectorAll('.gb-fmt-popup--role-opts').forEach(el => el.remove());
    document.querySelectorAll('.gb-fmt-popup:not(.gb-fmt-popup--role-opts)').forEach(el => el.remove());
    const popup = document.createElement('div');
    popup.className = 'gb-fmt-popup gb-fmt-popup--role-opts';
    const e = typeof esc === 'function' ? esc : (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const ts = chara.textStyle || {};
    const gs = chara.gutterStyle || {};
    const gs2 = chara.gutter2Style || {};
    const indentNum = parseFloat(chara.indent) || '';
    popup.innerHTML = `
      <div class="sn2-role-opts-title">オプション設定</div>
      <div class="sn2-role-opts-body">
        <div class="sn2-role-opts-row sn2-role-opts-row--top">
          <label class="sn2-role-opts-check-lbl">
            <input type="checkbox" data-opt-check="isBreak"${chara.isBreak ? ' checked' : ''}> 区切り
          </label>
          <span class="sn2-role-opts-hint">ページを切り替える</span>
        </div>
        <div class="sn2-role-opts-row">
          <label class="sn2-role-opts-check-lbl">
            <input type="checkbox" data-opt-check="isSpread"${chara.isSpread ? ' checked' : ''}> 見開き
          </label>
          <span class="sn2-role-opts-hint">「区切り」ON時のみ有効。連続時の偶数回目はページ送りせずコマ送り扱い（クリスタ送信用）</span>
        </div>
        <div class="sn2-role-opts-row">
          <label class="sn2-role-opts-check-lbl">
            <input type="checkbox" data-opt-check="isSummary"${chara.isSummary ? ' checked' : ''}> プロット
          </label>
          <span class="sn2-role-opts-hint">コマ番号を非表示にしリセット</span>
        </div>
        <div class="sn2-role-opts-row">
          <span class="sn2-role-opts-field-label">インデント</span>
          <input type="number" class="sn2-role-opts-input-num" data-opt="indent" value="${indentNum}" placeholder="0" min="0" max="20" step="0.5">
          <span class="sn2-role-opts-unit">em</span>
        </div>
        <div class="sn2-role-opts-row">
          <span class="sn2-role-opts-field-label">テキスト表示位置</span>
          <select class="sn2-role-opts-sel" data-opt-sel="textShiftDir">
            <option value=""${!chara.textShiftDir ? ' selected' : ''}>なし</option>
            <option value="before"${chara.textShiftDir === 'before' ? ' selected' : ''}>前にズラす</option>
            <option value="after"${chara.textShiftDir === 'after' ? ' selected' : ''}>後にズラす</option>
          </select>
          <input type="number" class="sn2-role-opts-input-num sn2-role-opts-input-num--sm" data-opt="textShiftCols" value="${chara.textShiftCols || ''}" placeholder="1" min="1" max="10">
          <span class="sn2-role-opts-unit">列</span>
        </div>
        <div class="sn2-role-opts-divider">
          <div class="sn2-role-opts-row sn2-role-opts-row--wrap">
            <label class="sn2-role-opts-check-lbl">
              <input type="checkbox" data-opt-check="outline"${chara.outline ? ' checked' : ''}> 見出し枠線
            </label>
            <span class="sn2-role-opts-sep">色</span>
            <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg gb-fmt-swatch--sm" data-outline-color="outlineColor"></button>
            <span class="sn2-role-opts-unit">太さ</span>
            <input type="number" class="sn2-role-opts-input-num sn2-role-opts-input-num--sm" data-opt="outlineWidth" value="${parseFloat(chara.outlineWidth) || 1}" placeholder="1" min="0.5" max="10" step="0.5">
            <span class="sn2-role-opts-unit">px</span>
          </div>
        </div>
        <div class="sn2-role-opts-divider-flex">
          <button type="button" class="sn2-detail-add-btn sn2-role-opts-flex1" data-role-duplicate>複製</button>
          <button type="button" class="sn2-detail-add-btn sn2-role-opts-flex1 sn2-role-opts-del" data-role-delete>削除</button>
        </div>
      </div>`;
    // outlineColor swatch 初期背景 (インライン指定)
    const outlineBtn = popup.querySelector('[data-outline-color]');
    if (outlineBtn) Object.assign(outlineBtn.style, { background: chara.outlineColor || 'var(--border)' });
    // 複製ボタン
    popup.querySelector('[data-role-duplicate]')?.addEventListener('click', () => {
      if (chara.isDefault) {
        if (typeof showStatus === 'function') showStatus('デフォルトタイプは複製できません', true);
        return;
      }
      this._pushUndo('タイプ複製');
      const dup = this._cloneChara(chara);
      dup.name = (chara.name || '') + '（コピー）';
      const idx = this.doc.characters.indexOf(chara);
      if (idx >= 0) this.doc.characters.splice(idx + 1, 0, dup);
      else this.doc.characters.push(dup);
      this._markDirty();
      popup.remove();
      this.renderDetailPanel(panelContainer);
    });
    // 削除ボタン
    popup.querySelector('[data-role-delete]')?.addEventListener('click', () => {
      if (chara.isDefault) {
        if (typeof showStatus === 'function') showStatus('デフォルトタイプは削除できません', true);
        return;
      }
      const name = chara.name || '（名称未設定）';
      showConfirmDialog(`タイプ「${name}」を削除しますか？`, () => {
        this._pushUndo('タイプ削除');
        this._clearRolesInRows([name]);
        const idx = this.doc.characters.indexOf(chara);
        if (idx >= 0) this.doc.characters.splice(idx, 1);
        this._detailSelection?.clear();
        this._markDirty();
        popup.remove();
        this.renderDetailPanel(panelContainer);
      });
    });
    popup.querySelectorAll('[data-opt]').forEach(inp => {
      inp.addEventListener('change', () => {
        this._pushUndo('オプション設定変更');
        const key = inp.dataset.opt;
        const val = inp.type === 'number' ? (inp.value ? Number(inp.value) : null) : inp.value;
        if (key === 'indent') {
          // インデントは em 単位の文字列で保存（空ならクリア）
          if (val) chara.indent = String(val) + 'em';
          else delete chara.indent;
          this._calcCache = null;
          this._render(); this._markDirty();
          return;
        }
        chara[key] = val;
        // 枠線関連プロパティはDOM再構築が必要
        if (key === 'outlineWidth') { this._render(); this._markDirty(); return; }
        this._refreshRowStyles(); this._markDirty();
        const item = anchorEl.closest('.sn2-detail-item');
        if (item?._applyPreview) item._applyPreview();
      });
    });
    // セレクト(配置・折り返し・位置ズラし方向)
    popup.querySelectorAll('[data-opt-sel]').forEach(sel => {
      sel.addEventListener('change', () => {
        this._pushUndo('オプション設定変更');
        chara[sel.dataset.optSel] = sel.value;
        this._render(); this._markDirty();
      });
    });
    // チェックボックス（区切り、プロット、枠線表示）
    popup.querySelectorAll('[data-opt-check]').forEach(cb => {
      cb.addEventListener('change', () => {
        this._pushUndo('オプション設定変更');
        const key = cb.dataset.optCheck;
        chara[key] = cb.checked;
        // 区切り/プロットはページ採番に影響するのでキャッシュクリア
        if (key === 'isBreak' || key === 'isSummary') this._calcCache = null;
        this._render(); this._markDirty();
      });
    });
    // 枠線カラーピッカー
    popup.querySelectorAll('[data-outline-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof openColorPalette === 'function') {
          openColorPalette(btn, chara.outlineColor || '#888', (color) => {
            this._pushUndo('枠線色変更');
            if (color === 'transparent') { delete chara.outlineColor; } else { chara.outlineColor = color; }
            Object.assign(btn.style, { background: chara.outlineColor || 'var(--border)' });
            this._render(); this._markDirty();
          });
        }
      });
    });
    document.body.appendChild(popup);
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(popup, {
        trigger: anchorEl,
        close: () => popup.remove(),
      });
    }
    if (typeof positionPopup === 'function') positionPopup(popup, anchorEl.getBoundingClientRect());
    else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
    setTimeout(() => {
      const closePopup = (ev) => {
        if (!popup.contains(ev.target) && ev.target !== anchorEl && !ev.target.closest?.('.gb-fmt-popup') && !ev.target.closest?.('.gb-palette-popup')) {
          popup.remove(); document.removeEventListener('pointerdown', closePopup);
        }
      };
      document.addEventListener('pointerdown', closePopup);
    }, 0);
  },

  // チャラのディープコピー（候補値共有を防ぐ）
  _cloneChara(src) {
    if (!src) return {};
    const out = { ...src };
    if (src.textStyle) out.textStyle = { ...src.textStyle };
    if (src.gutterStyle) out.gutterStyle = { ...src.gutterStyle };
    if (src.gutter2Style) out.gutter2Style = { ...src.gutter2Style };
    if (src.roleStyle) out.roleStyle = { ...src.roleStyle };
    if (src.customStyles) {
      out.customStyles = {};
      Object.entries(src.customStyles).forEach(([k, v]) => { out.customStyles[k] = { ...(v || {}) }; });
    }
    if (src.autoColorTarget && typeof src.autoColorTarget === 'object') out.autoColorTarget = { ...src.autoColorTarget };
    return out;
  },

  // 列の「全行に適用」ルール (doc.editor.columnAllRules) をchara に適用する
  _applyColumnAllRules(chara) {
    if (!chara) return;
    const rules = this.doc.editor?.columnAllRules || {};
    Object.entries(rules).forEach(([colId, rule]) => {
      if (!rule || typeof rule !== 'object') return;
      const style = this._getColStyle(chara, colId);
      Object.entries(rule).forEach(([prop, val]) => {
        if (val === '' || val === null || val === undefined) delete style[prop];
        else style[prop] = val;
      });
    });
  },

  // リセット後に自動配色を再適用する
  _reapplyAutoColor(chara) {
    if (!chara) return;
    const acRule = this.doc.editor?.autoColorRule || {};
    const allNone = Object.values(acRule).every(v => !v || v === 'none');
    if (allNone) { delete chara.autoColor; return; }
    // autoColorが未設定なら再割り当て
    if (!chara.autoColor) {
      const colors = typeof PALETTE_COLORS !== 'undefined' ? PALETTE_COLORS : [];
      if (colors.length) {
        const existingCount = this.doc.characters.filter(c => c !== chara && (c.autoColor || c.bgColor)).length;
        chara.autoColor = colors[existingCount % colors.length];
      }
    }
    chara.autoColorTarget = { ...acRule };
  },

  _refreshRowStyles() {
    if (!this.host) return;
    this.host.querySelectorAll('.sn2-row').forEach(rowEl => {
      const rowId = rowEl.dataset.rowId;
      const row = this.doc.rows.find(r => r.id === rowId);
      if (row) this._applyRowStyle(rowEl, row.role);
    });
  },

  _renameRoleInRows(oldName, newName) {
    if (!oldName || oldName === newName) return;
    this.doc.rows.forEach(r => { if (r.role === oldName) r.role = newName; });
    this.host?.querySelectorAll('.sn2-row').forEach(rowEl => {
      const rowId = rowEl.dataset.rowId;
      const row = this.doc.rows.find(r => r.id === rowId);
      if (row) {
        const btn = rowEl.querySelector('.sn2-role-btn');
        if (btn) btn.textContent = row.role || '';
        this._applyRowStyle(rowEl, row.role);
      }
    });
  },

  _clearRolesInRows(roleNames) {
    const targets = new Set((Array.isArray(roleNames) ? roleNames : [roleNames]).filter(Boolean));
    if (!targets.size) return;
    this.doc.rows.forEach(row => {
      if (targets.has(row.role)) row.role = '';
    });
    this.host?.querySelectorAll('.sn2-row').forEach(rowEl => {
      const rowId = rowEl.dataset.rowId;
      const row = this.doc.rows.find(r => r.id === rowId);
      if (!row) return;
      const btn = rowEl.querySelector('.sn2-role-btn');
      if (btn) btn.textContent = row.role || '';
      this._applyRowStyle(rowEl, row.role);
    });
  },

  _setupDetailDragDrop(listEl, panelContainer) {
    let dragIdx = -1;
    listEl.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.sn2-detail-item');
      if (!item) return;
      // デフォルト行はドラッグ不可
      if (item.classList.contains('sn2-detail-default')) { e.preventDefault(); return; }
      dragIdx = Number(item.dataset.idx);
      item.classList.add('sn2-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // 全アイテムのハイライトをクリアしてから、現在のアイテムだけハイライト
      listEl.querySelectorAll('.sn2-detail-item').forEach(el => {
        el.classList.remove('sn2-drop-above', 'sn2-drop-below');
      });
      const item = e.target.closest('.sn2-detail-item');
      if (item) {
        const rect = item.getBoundingClientRect();
        const isTop = e.clientY < rect.top + rect.height / 2;
        item.classList.toggle('sn2-drop-above', isTop);
        item.classList.toggle('sn2-drop-below', !isTop);
      }
    });
    listEl.addEventListener('dragend', () => {
      listEl.querySelectorAll('.sn2-detail-item').forEach(el => {
        el.classList.remove('sn2-dragging', 'sn2-drop-above', 'sn2-drop-below');
      });
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const item = e.target.closest('.sn2-detail-item');
      if (!item || dragIdx < 0) return;
      // デフォルト行はドラッグ元・ドロップ先のいずれでも対象外（末尾固定）
      if (this.doc.characters[dragIdx]?.isDefault) return;
      let dropIdx = Number(item.dataset.idx);
      const rect = item.getBoundingClientRect();
      if (e.clientY >= rect.top + rect.height / 2) dropIdx++;
      if (dropIdx === dragIdx || dropIdx === dragIdx + 1) return;
      // デフォルト行の位置 (= 末尾) より後ろには挿入させない
      const defIdx = this.doc.characters.findIndex(c => c.isDefault);
      if (defIdx >= 0 && dropIdx > defIdx) dropIdx = defIdx;
      this._pushUndo('タイプ並び替え');
      const [moved] = this.doc.characters.splice(dragIdx, 1);
      const insertAt = dropIdx > dragIdx ? dropIdx - 1 : dropIdx;
      this.doc.characters.splice(insertAt, 0, moved);
      this._ensureDefaultChara();
      this._detailSelection.clear();
      this._markDirty();
      this.renderDetailPanel(panelContainer);
    });
  },

  renderThemePanel(container) {
    if (!container || !this.doc) return;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'sn2-detail';
    const e = typeof esc === 'function' ? esc : (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // scroll 要素への setProperty ヘルパー（margin 用）
    const setScrollVar = (name, val) => {
      const scrollEl = this.host?.querySelector('.sn2-scroll');
      if (!scrollEl) return;
      if (val) scrollEl.style.setProperty(name, val);
      else scrollEl.style.removeProperty(name);
    };

    // ヘッダー + テーマタブへの誘導バナー
    const header = document.createElement('div');
    header.className = 'sn2-detail-header';
    header.innerHTML = '<span class="sn2-detail-theme-header-strong">挙動</span>';
    wrap.appendChild(header);
    const migrBanner = document.createElement('div');
    migrBanner.style.cssText = 'padding:6px 8px;margin:4px 0;font-size:11px;color:var(--fg2);background:var(--bg3);border-left:3px solid var(--accent);border-radius:3px;';
    migrBanner.textContent = '※ 色・基本テキスト・ルビなどのスタイル項目はオプションパネルの「テーマ」タブに移行しました。このタブは挙動系（枠線モード・見開き区切り・自動配色・カウント設定など）専用です。';
    wrap.appendChild(migrBanner);

    // 設定セクション
    const cc = this.doc.editor?.countConfig || {};
    const def = this._getCountDef();
    const borderMode = this.doc.editor?.borderMode || 'all';
    const borderColor = this.doc.editor?.borderColor || '';
    const borderWidth = this.doc.editor?.borderWidth || '';
    const parsedBorderWidth = parseFloat(borderWidth);
    const borderWidthValue = Number.isFinite(parsedBorderWidth) ? String(parsedBorderWidth) : '';
    const editorMargin = this.doc.editor?.margin || '';
    const mergeDisp = !!this.doc.editor?.mergeDisplay;
    const rawWheelSpeed = parseFloat(localStorage.getItem('meldex-wheel-speed'));
    const wheelSpeed = Number.isFinite(rawWheelSpeed) && rawWheelSpeed > 0
      ? Math.max(0.5, Math.min(5, rawWheelSpeed))
      : 2.5;
    const selOpt = (val, cur) => val === cur ? ' selected' : '';
    const mkCountRow = (prefix, label, defLabel) => {
      const pad = cc[prefix + 'Pad'] ?? cc.padDigits ?? 2;
      const pos = cc[prefix + 'Pos'] ?? cc.labelPosition ?? 'before';
      const lb = cc[prefix + 'LabelBefore'] ?? '';
      const la = cc[prefix + 'LabelAfter'] ?? '';
      const unitVal = cc[prefix + 'Label'] ?? defLabel;
      return `
      <div class="sn2-detail-settings-row">
        <label class="sn2-detail-settings-label sn2-detail-settings-label--w48">${label}</label>
        <label class="sn2-detail-settings-label">単位</label>
        <input type="text" class="sn2-detail-settings-input sn2-detail-settings-input--w56" data-setting="${prefix}Label" value="${e(unitVal)}" placeholder="${defLabel}">
        <label class="sn2-detail-settings-label">桁</label>
        <input type="number" class="sn2-detail-settings-input sn2-detail-settings-input--w28" data-setting="${prefix}Pad" value="${pad}" min="0" max="5">
        <label class="sn2-detail-settings-label">位置</label>
        <select class="sn2-detail-settings-select" data-setting="${prefix}Pos">
          <option value="before"${selOpt('before', pos)}>単位+数</option>
          <option value="after"${selOpt('after', pos)}>数+単位</option>
          <option value="both"${selOpt('both', pos)}>前+数+後</option>
        </select>
        ${pos === 'both' ? `
          <input type="text" class="sn2-detail-settings-input sn2-detail-settings-input--w28" data-setting="${prefix}LabelBefore" value="${e(lb !== undefined && lb !== null ? lb : unitVal)}" placeholder="前" title="前の単位">
          <input type="text" class="sn2-detail-settings-input sn2-detail-settings-input--w28" data-setting="${prefix}LabelAfter" value="${e(la !== undefined && la !== null ? la : unitVal)}" placeholder="後" title="後の単位">
        ` : ''}
      </div>`;
    };
    const settings = document.createElement('div');
    settings.className = 'sn2-detail-settings';
    settings.innerHTML = `
      <div class="sn2-detail-settings-row">
        <label class="sn2-detail-settings-label">枠線</label>
        <select class="sn2-detail-settings-select" data-setting="borderMode">
          <option value="all"${selOpt('all', borderMode)}>すべて</option>
          <option value="horizontal"${selOpt('horizontal', borderMode)}>横線のみ</option>
          <option value="vertical"${selOpt('vertical', borderMode)}>縦線のみ</option>
          <option value="none"${selOpt('none', borderMode)}>非表示</option>
        </select>
        <label class="sn2-detail-settings-label">色</label>
        <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg gb-fmt-swatch--xs" data-setting-color="borderColor" title="枠線の色"></button>
        <label class="sn2-detail-settings-label">太さ</label>
        <input type="number" class="sn2-detail-settings-input sn2-detail-settings-input--w36" data-setting="borderWidth" value="${e(borderWidthValue)}" placeholder="1" min="0" max="10" step="0.5">
        <span class="sn2-detail-settings-label sn2-detail-settings-label--ml0">px</span>
        <label class="sn2-detail-settings-label">余白</label>
        <input type="text" class="sn2-detail-settings-input sn2-detail-settings-input--w48" data-setting="margin" value="${e(editorMargin)}" placeholder="16px" title="余白（折り返し時の段間隔にもなる）">
      </div>
      <div class="sn2-detail-settings-row">
        <label class="sn2-detail-settings-label sn2-detail-settings-label--mr2">
          <input type="checkbox" data-setting="mergeDisplay"${mergeDisp ? ' checked' : ''}> まとめ表示
        </label>
      </div>
      <div class="sn2-detail-settings-row" style="flex-wrap:nowrap;">
        <label class="sn2-detail-settings-label">ホイール速度</label>
        <input type="range" class="gb-range" style="min-width:120px;flex:1;" min="0.5" max="5" step="0.1" value="${e(wheelSpeed.toFixed(1))}" data-sn2-wheel-speed>
        <span class="sn2-detail-settings-label sn2-detail-settings-label--ml0" style="width:48px;text-align:right;" data-sn2-wheel-speed-value>${e(wheelSpeed.toFixed(1))}倍</span>
      </div>
      <div class="sn2-detail-settings-row">
        <label class="sn2-detail-settings-label sn2-detail-settings-label--mr2">
          <input type="checkbox" data-setting="spreadBorderEnabled"${this.doc.editor?.spreadBorder?.enabled ? ' checked' : ''}> 見開き区切り
        </label>
        <label class="sn2-detail-settings-label">開始</label>
        <input type="number" class="sn2-detail-settings-input sn2-detail-settings-input--w36" data-setting="spreadBorderStart" value="${this.doc.editor?.spreadBorder?.start ?? 1}" min="1" max="999" title="区切り線を引く最初のページ番号">
        <label class="sn2-detail-settings-label">間隔</label>
        <input type="number" class="sn2-detail-settings-input sn2-detail-settings-input--w36" data-setting="spreadBorderEvery" value="${this.doc.editor?.spreadBorder?.every ?? 2}" min="1" max="99" title="何ページごとに区切り線を引くか">
        <span class="sn2-detail-settings-label">p</span>
      </div>
      <div class="sn2-detail-settings-row">
        <label class="sn2-detail-settings-label">列間枠線</label>
        <div id="sn2-col-border-ui" class="sn2-detail-colborder-ui"></div>
      </div>
      ${mkCountRow('primary', '大区切り', def.primaryLabel)}
      ${mkCountRow('secondary', '小区切り', def.secondaryLabel)}`;
    // 枠線色スウォッチの初期背景色
    const borderSwBtn = settings.querySelector('[data-setting-color="borderColor"]');
    if (borderSwBtn) borderSwBtn.style.background = borderColor || 'var(--border)';
    const wheelSpeedInput = settings.querySelector('[data-sn2-wheel-speed]');
    const wheelSpeedValue = settings.querySelector('[data-sn2-wheel-speed-value]');
    if (wheelSpeedInput && wheelSpeedValue) {
      const updateWheelSpeed = (save) => {
        const raw = parseFloat(wheelSpeedInput.value);
        const next = Number.isFinite(raw) ? Math.max(0.5, Math.min(5, raw)) : 2.5;
        wheelSpeedInput.value = next.toFixed(1);
        wheelSpeedValue.textContent = next.toFixed(1) + '倍';
        if (save) localStorage.setItem('meldex-wheel-speed', String(next));
        globalThis.GBUI?.refreshRangeFill?.(wheelSpeedInput);
      };
      wheelSpeedInput.addEventListener('input', () => updateWheelSpeed(true));
      updateWheelSpeed(false);
    }
    // editor 要素への setProperty 用ヘルパー (settings セクション内で使用)
    const setEditorVar = (name, val) => {
      const editorEl = this.host?.querySelector('.sn2-editor');
      if (!editorEl) return;
      if (val) editorEl.style.setProperty(name, val);
      else editorEl.style.removeProperty(name);
    };

    // カラースウォッチのクリックハンドラ (borderColor のみ)
    settings.querySelectorAll('[data-setting-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        const prop = btn.dataset.settingColor;
        const current = this.doc.editor?.[prop] || '';
        const applySetting = (color) => {
          this._pushUndo('枠線色変更');
          const isNone = color === 'transparent';
          if (isNone) { delete this.doc.editor[prop]; } else { this.doc.editor[prop] = color; }
          Object.assign(btn.style, { background: isNone ? 'var(--bg3)' : color });
          if (prop === 'borderColor') {
            setEditorVar('--sn2-border-color', isNone ? 'var(--border)' : color);
          }
          this._markDirty();
        };
        if (typeof openColorPalette === 'function') {
          openColorPalette(btn, current || '#888', applySetting);
        }
      });
    });
    settings.addEventListener('change', (ev) => {
      const el = ev.target;
      const key = el.dataset.setting;
      if (!key) return;
      this._pushUndo('テーマ設定変更');
      if (!this.doc.editor.countConfig) this.doc.editor.countConfig = {};
      const editorEl = this.host?.querySelector('.sn2-editor');
      if (key === 'borderMode') {
        this.doc.editor.borderMode = el.value;
        if (editorEl) editorEl.dataset.border = el.value;
      } else if (key === 'borderWidth') {
        const bw = el.value.trim();
        this.doc.editor.borderWidth = bw ? bw + 'px' : '';
        setEditorVar('--sn2-border-width', bw ? bw + 'px' : '1px');
      } else if (key === 'margin') {
        const mv = el.value.trim();
        this.doc.editor.margin = mv;
        const mvCss = mv ? (/^\d+$/.test(mv) ? mv + 'px' : mv) : '';
        setScrollVar('--sn2-margin', mvCss);
        this._render();
      } else if (key === 'mergeDisplay') {
        this.doc.editor.mergeDisplay = el.checked;
        this._render();
        // ツールバーのボタン状態も同期
        document.querySelectorAll('#btn-merge-display').forEach(btn => btn.classList.toggle('active', el.checked));
      } else if (key === 'spreadBorderEnabled') {
        if (!this.doc.editor.spreadBorder) this.doc.editor.spreadBorder = {};
        this.doc.editor.spreadBorder.enabled = el.checked;
        this._render();
      } else if (key === 'spreadBorderStart') {
        if (!this.doc.editor.spreadBorder) this.doc.editor.spreadBorder = {};
        this.doc.editor.spreadBorder.start = Math.max(1, parseInt(el.value) || 1);
        this._render();
      } else if (key === 'spreadBorderEvery') {
        if (!this.doc.editor.spreadBorder) this.doc.editor.spreadBorder = {};
        this.doc.editor.spreadBorder.every = Math.max(1, parseInt(el.value) || 2);
        this._render();
      } else if (key.endsWith('Pos') && el.value === 'both') {
        // 「前+数+後」選択時はパネルを再描画して前後入力欄を表示
        this.doc.editor.countConfig[key] = el.value;
        this._calcCache = null;
        this._updateGuttersFrom(0);
        this._markDirty();
        this.renderThemePanel(container);
        return;
      } else {
        // countConfig系（primaryLabel, primaryPad, primaryPos, secondaryLabel, etc.）
        const val = el.type === 'number' ? (Number(el.value) || 0) : el.value.trim();
        this.doc.editor.countConfig[key] = val;
        this._calcCache = null;
        this._updateGuttersFrom(0);

/* Source chunk: gb-scriptnote-detail.part03.js */
      }
      this._markDirty();
    });
    wrap.appendChild(settings);
    const statusEnabled = !!this.doc.editor?.statusEnabled;
    const statusSection = document.createElement('div');
    statusSection.className = 'sn2-detail-settings';
    statusSection.style.marginTop = '8px';
    const statusTitle = document.createElement('div');
    statusTitle.className = 'sn2-detail-ac-title';
    statusTitle.textContent = '採用状況';
    statusSection.appendChild(statusTitle);
    const statusBar = document.createElement('div');
    statusBar.className = 'sn2-detail-settings-row';
    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'sn2-detail-settings-label sn2-detail-settings-label--mr2';
    enabledLabel.innerHTML = `<input type="checkbox" data-status-setting="enabled"${statusEnabled ? ' checked' : ''}> ステータス機能`;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'sn2-detail-add-btn';
    addBtn.textContent = '＋ステータス';
    addBtn.disabled = !statusEnabled;
    statusBar.appendChild(enabledLabel);
    statusBar.appendChild(addBtn);
    statusSection.appendChild(statusBar);
    const statusListWrap = document.createElement('div');
    statusListWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    (this._getStatusList ? this._getStatusList() : []).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'sn2-detail-settings-row';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg gb-fmt-swatch--xs" data-status-color="${index}" title="色"></button>
        <input type="text" class="sn2-detail-settings-input" style="width:96px;" data-status-name="${index}" value="${typeof esc === 'function' ? esc(item.name) : item.name}" placeholder="名称"${statusEnabled ? '' : ' disabled'}>
        <button type="button" class="sn2-detail-add-btn" data-status-delete="${index}"${statusEnabled ? '' : ' disabled'}>削除</button>`;
      statusListWrap.appendChild(row);
      const sw = row.querySelector('[data-status-color]');
      if (sw) sw.style.background = item.color || 'var(--bg3)';
    });
    statusSection.appendChild(statusListWrap);
    addBtn.addEventListener('click', () => {
      this._pushUndo('採用状況設定変更');
      const list = this._getStatusList();
      list.push({ name: `状態${list.length + 1}`, color: SCRIPTNOTE_DEFAULT_STATUS_LIST[list.length % SCRIPTNOTE_DEFAULT_STATUS_LIST.length].color });
      this.doc.editor.statusList = list;
      this._markDirty();
      this.renderThemePanel(container);
    });
    statusSection.querySelector('[data-status-setting="enabled"]')?.addEventListener('change', (ev) => {
      this._pushUndo('採用状況設定変更');
      this.doc.editor.statusEnabled = ev.target.checked;
      if (!ev.target.checked) {
        this._filterStatuses = null;
        this._hideStatuses = null;
      }
      this._syncFilterButtonState?.();
      this._markDirty();
      this._render();
      this.renderThemePanel(container);
    });
    statusSection.querySelectorAll('[data-status-name]').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.statusName);
        const list = this._getStatusList();
        if (!list[idx]) return;
        this._pushUndo('採用状況設定変更');
        const oldName = list[idx].name;
        list[idx].name = input.value.trim() || list[idx].name || `状態${idx + 1}`;
        (this.doc.rows || []).forEach((row) => {
          if ((row.status || '') === oldName) row.status = list[idx].name;
        });
        this.doc.editor.statusList = _sn2NormalizeStatusList(list);
        this._clearInvalidStatuses?.();
        this._markDirty();
        this._render();
        this.renderThemePanel(container);
      });
    });
    statusSection.querySelectorAll('[data-status-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = Number(button.dataset.statusDelete);
        const list = this._getStatusList();
        if (!list[idx] || list.length <= 1) return;
        this._pushUndo('採用状況設定変更');
        const removed = list.splice(idx, 1)[0];
        this.doc.editor.statusList = _sn2NormalizeStatusList(list);
        this._clearInvalidStatuses?.(removed?.name || '');
        this._markDirty();
        this._render();
        this.renderThemePanel(container);
      });
    });
    statusSection.querySelectorAll('[data-status-color]').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = Number(button.dataset.statusColor);
        const list = this._getStatusList();
        if (!list[idx] || typeof openColorPalette !== 'function') return;
        openColorPalette(button, list[idx].color || '#6fa8dc', (color) => {
          this._pushUndo('採用状況設定変更');
          list[idx].color = color === 'transparent' ? '#6fa8dc' : color;
          this.doc.editor.statusList = _sn2NormalizeStatusList(list);
          button.style.background = list[idx].color;
          this._markDirty();
          this._render();
        });
      });
    });
    wrap.appendChild(statusSection);
    // 列間枠線UI: 列名の間にチェックボックスを配置
    const colBorderUI = settings.querySelector('#sn2-col-border-ui');
    if (colBorderUI) {
      const borderSet = this._getColumnBorderSet();
      const colLabels = this.doc.editor?.columnLabels || {};
      const countDef2 = this._getCountDef();
      const defaultLabels = { _gutter: countDef2.primaryLabel, _gutter2: countDef2.secondaryLabel, _role: 'タイプ', _status: '採用状況', _text: 'テキスト' };
      const visCols2 = { _handle: true, _gutter: true, _gutter2: true, _role: true, _status: statusEnabled, _text: true, ...(this.doc.editor?.visibleStandardColumns || {}) };
      if (!statusEnabled) visCols2._status = false;
      const allCols = [];
      if (visCols2._gutter !== false) allCols.push({ id: '_gutter', label: colLabels._gutter || defaultLabels._gutter });
      if (visCols2._gutter2 !== false) allCols.push({ id: '_gutter2', label: colLabels._gutter2 || defaultLabels._gutter2 });
      if (visCols2._role !== false) allCols.push({ id: '_role', label: colLabels._role || defaultLabels._role });
      if (visCols2._status !== false) allCols.push({ id: '_status', label: colLabels._status || defaultLabels._status });
      if (visCols2._text !== false) allCols.push({ id: '_text', label: colLabels._text || defaultLabels._text });
      (this.doc.editor?.customColumns || []).forEach(c => allCols.push({ id: c.id, label: c.label || c.id }));
      allCols.forEach((col, i) => {
        // 列名ラベル
        const lbl = document.createElement('span');
        lbl.className = 'sn2-detail-colborder-lbl';
        lbl.textContent = col.label;
        colBorderUI.appendChild(lbl);
        // 最後の列でなければチェックボックス
        if (i < allCols.length - 1) {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = borderSet.has(col.id);
          cb.title = col.label + ' | ' + allCols[i + 1].label + ' 間';
          cb.className = 'sn2-detail-colborder-cb';
          cb.addEventListener('change', () => {
            this._pushUndo('列間枠線変更');
            const newSet = this._getColumnBorderSet();
            if (cb.checked) newSet.add(col.id); else newSet.delete(col.id);
            this.doc.editor.columnBorders = Array.from(newSet);
            this._markDirty();
            this._render();
          });
          colBorderUI.appendChild(cb);
        }
      });
    }

    // 自動配色セクション（列ごとに 背景 / 文字 / 両方 / なし を切替）
    const acSection = document.createElement('div');
    acSection.className = 'sn2-detail-settings sn2-detail-theme-section--autocolor';
    const acTitle = document.createElement('div');
    acTitle.className = 'sn2-detail-ac-title';
    acTitle.textContent = '自動配色';
    acSection.appendChild(acTitle);
    const colDefs = [
      { id: '_gutter', label: '大区切り' },
      { id: '_gutter2', label: '小区切り' },
      { id: '_role', label: 'タイプ' },
      { id: '_text', label: 'テキスト' },
    ];
    // ヘッダー行
    const acHeader = document.createElement('div');
    acHeader.className = 'sn2-detail-settings-row';
    acHeader.innerHTML = colDefs.map(cd =>
      `<span class="sn2-detail-settings-label sn2-detail-ac-settings-label">${cd.label}</span>`
    ).join('');
    acSection.appendChild(acHeader);
    const acSelOpt = (val, cur) => val === cur ? ' selected' : '';
    const acRule = this.doc.editor?.autoColorRule || {};
    const acRow = document.createElement('div');
    acRow.className = 'sn2-detail-settings-row';
    acRow.innerHTML = colDefs.map(cd => {
      const cur = acRule[cd.id] || 'none';
      return `<select data-ac-col="${cd.id}" class="sn2-detail-settings-select sn2-detail-ac-select">
        <option value="bg"${acSelOpt('bg', cur)}>背景</option>
        <option value="text"${acSelOpt('text', cur)}>文字</option>
        <option value="both"${acSelOpt('both', cur)}>両方</option>
        <option value="none"${acSelOpt('none', cur)}>なし</option>
      </select>`;
    }).join('');
    acSection.appendChild(acRow);
    acSection.addEventListener('change', (ev) => {
      const sel = ev.target.closest('[data-ac-col]');
      if (!sel) return;
      this._pushUndo('自動配色変更');
      if (!this.doc.editor.autoColorRule) this.doc.editor.autoColorRule = {};
      const colId = sel.dataset.acCol;
      this.doc.editor.autoColorRule[colId] = sel.value;
      const rule = { ...this.doc.editor.autoColorRule };
      // すべての非デフォルトタイプに同じターゲットを適用
      (this.doc.characters || []).forEach(chara => {
        if (chara.isDefault) return;
        chara.autoColorTarget = { ...rule };
      });
      this._refreshRowStyles();
      this._markDirty();
    });
    wrap.appendChild(acSection);

    container.appendChild(wrap);
  },

});
