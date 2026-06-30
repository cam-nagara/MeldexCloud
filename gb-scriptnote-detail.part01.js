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

    const mkBtn = (label, title, onClick, e2eId = '') => {
      const b = document.createElement('button');
      b.className = 'sn2-detail-add-btn';
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      if (e2eId) b.dataset.e2eId = e2eId;
      b.addEventListener('click', onClick);
      return b;
    };

    // ツールバー（タイトルバーなし、適用・DB読込を右寄せ）
    const toolbar = document.createElement('div');
    toolbar.className = 'sn2-detail-toolbar';
    toolbar.appendChild(mkBtn('＋追加', '新規タイプ追加', () => {
      this._pushUndo('タイプ追加');
      const newChara = { name: this._uniqueRoleName ? this._uniqueRoleName('新しいキャラ') : '新しいキャラ' };
      this._assignAutoColor(newChara);
      this._applyColumnAllRules(newChara);
      // デフォルトタイプの直前に挿入（末尾固定の不変条件を維持）
      const defIdx = this.doc.characters.findIndex(c => c.isDefault);
      if (defIdx >= 0) this.doc.characters.splice(defIdx, 0, newChara);
      else this.doc.characters.push(newChara);
      this._detailSelection.clear();
      this._markDirty();
      this.renderDetailPanel(container);
    }, 'scriptnote-detail-add-type'));
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
          dup.name = this._uniqueRoleName ? this._uniqueRoleName((src.name || 'タイプ') + '（コピー）', src) : src.name + '（コピー）';
          this.doc.characters.splice(i + offset + 1, 0, dup);
          offset++;
        }
      });
      this._detailSelection.clear();
      this._markDirty();
      this.renderDetailPanel(container);
    }, 'scriptnote-detail-duplicate-selected'));
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
        this._calcCache = null;
        this._render();
        this._markDirty();
        this.renderDetailPanel(container);
      });
    }, 'scriptnote-detail-delete-selected'));
    // 全選択ボタン
    const selectAllBtn = mkBtn('全選択', 'すべてのタイプを選択', () => {
      this.doc.characters.forEach((_, i) => this._detailSelection.add(i));
      container.querySelectorAll('.sn2-detail-item').forEach(el => {
        el.classList.add('selected');
        const cb = el.querySelector('.sn2-detail-check');
        if (cb) cb.checked = true;
      });
      this._updateBulkBar(toolbar);
    }, 'scriptnote-detail-select-all');
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
    }, 'scriptnote-detail-deselect-all');
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
    const bulkAllBtn = mkBtn('一括設定…', '全プロパティ一括変更', () => this._showBulkEditPopup(container), 'scriptnote-detail-bulk-settings');
    bulkAllBtn.className += ' sn2-detail-bulk-btn';
    toolbar.appendChild(bulkAllBtn);
    // 右寄せスペーサー + DB読込
    const spacer = document.createElement('span');
    spacer.className = 'sn2-detail-toolbar-spacer';
    toolbar.appendChild(spacer);
    toolbar.appendChild(mkBtn('DB読込', 'DBからキャラ読み込み', () => this._showDbImportModal(container), 'scriptnote-detail-import-db'));
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
    check.dataset.e2eId = 'scriptnote-detail-row-check-' + idx;
    check.dataset.sn2DetailIndex = String(idx);
    const checkLabel = isDefaultRow
      ? '空行を選択'
      : '行を選択: ' + (chara.name || chara.label || chara.role || String(idx + 1));
    check.setAttribute('aria-label', checkLabel);
    check.title = checkLabel;
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
    const CELL_LABELS = {
      _gutter: this._detailCellPreviewLabel('_gutter'),
      _gutter2: this._detailCellPreviewLabel('_gutter2'),
      _role: null,
      _text: this._detailCellPreviewLabel('_text'),
    };
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
      // フォント: _text列は旧データ互換のcharaフォールバックを使う。_role列はタイプ列専用設定のみ使う。
      const isRole = col.id === '_role';
      const fwActive = (isText ? (cs.fontWeight || chara.fontWeight) : cs.fontWeight) === 'bold';
      const fstActive = (isText ? (cs.fontStyle || chara.fontStyle) : cs.fontStyle) === 'italic';
      const effFz = isText ? (cs.fontSize || chara.fontSize) : cs.fontSize;
      const effFont = isText ? (cs.fontFamily || chara.fontFamily) : cs.fontFamily;
      const effStrokeColor = isText ? (cs.textStrokeColor || chara.textStrokeColor) : cs.textStrokeColor;
      const effStrokeWidth = isText ? (cs.textStrokeWidth || chara.textStrokeWidth) : cs.textStrokeWidth;
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
          nameInput.dataset.e2eId = 'scriptnote-detail-role-name-input-' + idx;
          nameInput.dataset.sn2DetailIndex = String(idx);
          applyDynStyle(nameInput, dynStyle);
          nameInput.addEventListener('change', () => {
            const oldName = chara.name;
            const newName = this._uniqueRoleName ? this._uniqueRoleName(nameInput.value, chara) : (nameInput.value.trim() || oldName || 'タイプ');
            nameInput.value = newName;
            if (newName === oldName) return;
            this._pushUndo('タイプ名変更');
            chara.name = newName;
            this._renameRoleInRows(oldName, chara.name);
            this._markDirty();
            this.renderDetailPanel(panelContainer);
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
      optBtn.dataset.e2eId = 'scriptnote-detail-role-options-' + idx;
      optBtn.dataset.sn2DetailIndex = String(idx);
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
        // フォント: _text列は旧データ互換のcharaフォールバックを使う。_role列はタイプ列専用設定のみ使う。
        const fw = (isText ? (cs.fontWeight || chara.fontWeight) : cs.fontWeight) === 'bold' ? 'bold' : '';
        const fst = (isText ? (cs.fontStyle || chara.fontStyle) : cs.fontStyle) === 'italic' ? 'italic' : '';
        const fz = isText ? (cs.fontSize || chara.fontSize || '') : (cs.fontSize || '');
        const ff = isText ? (cs.fontFamily || chara.fontFamily || '') : (cs.fontFamily || '');
        const strokeColor = isText ? (cs.textStrokeColor || chara.textStrokeColor || '') : (cs.textStrokeColor || '');
        const strokeWidth = isText ? (cs.textStrokeWidth || chara.textStrokeWidth || '') : (cs.textStrokeWidth || '');
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
            const label = this._detailCellPreviewLabel(pc.colId) ?? (CELL_LABELS[pc.colId] !== undefined ? CELL_LABELS[pc.colId] : '');
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

  _detailMultiSelectionPositionAnchor(anchorEl, panelContainer) {
    if (!this._detailSelection || this._detailSelection.size <= 1) return null;
    const root = panelContainer || anchorEl?.closest?.('.sn2-detail') || document;
    const selectedRows = [...this._detailSelection]
      .map(idx => root.querySelector?.(`.sn2-detail-item[data-idx="${idx}"]`))
      .filter(Boolean);
    const rows = selectedRows.length
      ? selectedRows
      : Array.from(root.querySelectorAll?.('.sn2-detail-item.selected') || []);
    let bottomRect = null;
    rows.forEach((row) => {
      const rect = row.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      if (!bottomRect || rect.bottom > bottomRect.bottom || (rect.bottom === bottomRect.bottom && rect.top > bottomRect.top)) {
        bottomRect = rect;
      }
    });
    if (!bottomRect) return null;
    const anchorRect = {
      left: bottomRect.left,
      right: bottomRect.right,
      top: bottomRect.bottom,
      bottom: bottomRect.bottom,
    };
    return { getBoundingClientRect: () => anchorRect };
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
    const isEmptyBulkValue = (value) => value === '' || value === null || value === undefined
      || (typeof value === 'number' && !Number.isFinite(value));
    const setBulkValue = (target, prop, value) => {
      if (!target) return;
      if (isEmptyBulkValue(value)) delete target[prop];
      else target[prop] = value;
    };
    const cleanupTextStyle = (chara) => {
      if (chara?.textStyle && !Object.keys(chara.textStyle).length) delete chara.textStyle;
    };
    const mirrorToTextStyle = new Set(['bgColor', 'textColor', 'fontWeight', 'fontStyle', 'fontSize', 'textBefore', 'textAfter']);
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
            if (!chara.textStyle && !isEmptyBulkValue(val)) chara.textStyle = {};
            if (chara.textStyle) {
              setBulkValue(chara.textStyle, realProp, val);
              cleanupTextStyle(chara);
            }
          } else if (realProp === 'kind') {
            chara.kind = val;
            chara.isBreak = val === 'break';
            chara.isSummary = val === 'summary';
            this._calcCache = null;
          } else {
            setBulkValue(chara, realProp, val);
            if (mirrorToTextStyle.has(realProp)) {
              if (!chara.textStyle && !isEmptyBulkValue(val)) chara.textStyle = {};
              if (chara.textStyle) {
                setBulkValue(chara.textStyle, realProp, val);
                cleanupTextStyle(chara);
              }
            }
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
    const positionAnchor = this._detailMultiSelectionPositionAnchor(anchor, panelContainer) || anchor;
    if (typeof positionPopup === 'function') positionPopup(popup, positionAnchor.getBoundingClientRect());
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
      const isCharacterDbFolder = (item) => /キャラ|キャラクター|登場人物|人物|character|chara|cast/i.test(String(item?.name || item?.path || ''));
      const visited = new Set();
      const addPageGroup = (folder, pages) => {
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
      };
      const scanFolder = async (folder, depth = 0) => {
        const path = String(folder?.path || '');
        if (!path || visited.has(path) || depth > 4) return;
        visited.add(path);
        const entries = await apiFetch('/browse?path=' + encodeURIComponent(path) + '&all_files=true').catch(() => []);
        if ((folder.type === 'database' || folder.type === 'folder') && isCharacterDbFolder(folder)) {
          const pages = (entries || []).filter(it => it.type === 'page' || it.type === 'entity');
          if (pages.length) addPageGroup(folder, pages);
        }
        const childFolders = (entries || []).filter(it => it.type === 'folder' || it.type === 'database');
        for (const child of childFolders) await scanFolder(child, depth + 1);
      };
      // DBツリーを構築: ルート配下を再帰走査し、キャラ/登場人物系のシートだけを候補にする
      for (const root of roots) {
        const items = await apiFetch('/browse?path=' + encodeURIComponent(root.path) + '&all_files=true').catch(() => []);
        const dbFolders = (items || []).filter(it => it.type === 'folder' || it.type === 'database');
        for (const folder of dbFolders) await scanFolder(folder, 0);
      }
      if (!treeHost.children.length) {
        const empty = document.createElement('div');
        empty.className = 'sn2-db-import-empty';
        empty.textContent = 'キャラ用のシートが見つかりませんでした';
        treeHost.appendChild(empty);
      }
      overlay.querySelector('#sn2-db-cancel').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#sn2-db-ok').addEventListener('click', () => {
        this._pushUndo('DBインポート');
        selectedNames.forEach(name => {
          if (!this.doc.characters.some(c => !c.isDefault && c.name === name)) {
            const newChara = { name: this._uniqueRoleName ? this._uniqueRoleName(name) : name };
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

  _countConfigPrefixForColumn(colId) {
    if (colId === '_gutter') return 'primary';
    if (colId === '_gutter2') return 'secondary';
    return '';
  },

  _countConfigLabelForPrefix(prefix) {
    return prefix === 'primary' ? '大区切り' : '小区切り';
  },

  _countConfigDefaultLabel(prefix) {
    const def = this._getCountDef ? this._getCountDef() : {};
    return prefix === 'primary' ? (def.primaryLabel || 'p') : (def.secondaryLabel || 'コマ');
  },

  _countConfigFieldValues(prefix) {
    const cc = this.doc?.editor?.countConfig || {};
    const unit = cc[prefix + 'Label'] ?? this._countConfigDefaultLabel(prefix);
    const pad = Math.max(0, Math.min(5, Number(cc[prefix + 'Pad'] ?? cc.padDigits ?? 2) || 0));
    const pos = ['before', 'after', 'both'].includes(cc[prefix + 'Pos']) ? cc[prefix + 'Pos'] : (cc.labelPosition || 'before');
    const labelBeforeRaw = cc[prefix + 'LabelBefore'];
    const labelAfterRaw = cc[prefix + 'LabelAfter'];
    return {
      unit,
      pad,
      pos: ['before', 'after', 'both'].includes(pos) ? pos : 'before',
      labelBefore: labelBeforeRaw == null ? unit : labelBeforeRaw,
      labelAfter: labelAfterRaw == null ? unit : labelAfterRaw,
    };
  },

  _detailCellPreviewLabel(colId) {
    const prefix = this._countConfigPrefixForColumn(colId);
    if (prefix) {
      const values = this._countConfigFieldValues(prefix);
      return this._fmtCount(values.unit, 1, {
        pad: values.pad,
        pos: values.pos,
        labelBefore: values.labelBefore,
        labelAfter: values.labelAfter,
      });
    }
    if (colId === '_role') return null;
    if (colId === '_text') return 'テキスト列';
    return '';
  },

  _refreshDetailCountPreviews(panelContainer) {
    const root = panelContainer || document;
    root.querySelectorAll?.('.sn2-detail-item').forEach((item) => {
      if (item?._applyPreview) item._applyPreview();
    });
  },

  _applyCountConfigFormatSetting(key, value, panelContainer) {
    if (!key) return;
    if (!this.doc.editor) this.doc.editor = {};
    if (!this.doc.editor.countConfig) this.doc.editor.countConfig = {};
    this._pushUndo('区切り表示設定変更');
    const cc = this.doc.editor.countConfig;
    if (key.endsWith('Pad')) {
      const parsed = Number(value);
      cc[key] = Math.max(0, Math.min(5, Number.isFinite(parsed) ? Math.round(parsed) : 0));
    } else if (key.endsWith('Pos')) {
      cc[key] = ['before', 'after', 'both'].includes(value) ? value : 'before';
      if (cc[key] === 'both') {
        const prefix = key.slice(0, -3);
        const unitVal = cc[prefix + 'Label'] ?? this._countConfigDefaultLabel(prefix);
        if (cc[prefix + 'LabelBefore'] == null) cc[prefix + 'LabelBefore'] = unitVal;
        if (cc[prefix + 'LabelAfter'] == null) cc[prefix + 'LabelAfter'] = unitVal;
      }
    } else {
      cc[key] = String(value == null ? '' : value).trim();
    }
    this._calcCache = null;
    this._updateGuttersFrom(0);
    this._render();
    this._markDirty();
    this._refreshDetailCountPreviews(panelContainer);
  },

  _buildCountConfigFormatControls(colId, panelContainer) {
    const prefix = this._countConfigPrefixForColumn(colId);
    if (!prefix || typeof gbFmt === 'undefined') return [];
    const label = this._countConfigLabelForPrefix(prefix);
    const values = this._countConfigFieldValues(prefix);
    const unitKey = prefix + 'Label';
    const padKey = prefix + 'Pad';
    const posKey = prefix + 'Pos';
    const beforeKey = prefix + 'LabelBefore';
    const afterKey = prefix + 'LabelAfter';
    const update = (key, value) => this._applyCountConfigFormatSetting(key, value, panelContainer);

    const unitInput = gbFmt.makeTextInput({
      value: values.unit,
      placeholder: this._countConfigDefaultLabel(prefix),
      title: label + 'の単位',
      width: 54,
      onChange: (v) => update(unitKey, v),
    });
    unitInput.dataset.e2eId = `scriptnote-format-${prefix}-label`;
    const padInput = gbFmt.makeNumInput({
      title: label + 'の桁',
      value: values.pad,
      min: 0,
      max: 5,
      width: 44,
      placeholder: '桁',
      allowEmpty: false,
      onChange: (v) => update(padKey, v),
    });
    padInput.dataset.e2eId = `scriptnote-format-${prefix}-pad`;
    const posSelect = gbFmt.makeSelect({
      value: values.pos,
      opts: [
        { v: 'before', l: '単位+数' },
        { v: 'after', l: '数+単位' },
        { v: 'both', l: '前+数+後' },
      ],
      onChange: (v) => {
        update(posKey, v);
        syncBothControls();
      },
    });
    posSelect.title = label + 'の表示位置';
    posSelect.dataset.e2eId = `scriptnote-format-${prefix}-position`;

    const beforeInput = gbFmt.makeTextInput({
      value: values.labelBefore,
      placeholder: '前',
      title: label + 'の前の単位',
      width: 36,
      onChange: (v) => update(beforeKey, v),
    });
    beforeInput.dataset.e2eId = `scriptnote-format-${prefix}-label-before`;
    const afterInput = gbFmt.makeTextInput({
      value: values.labelAfter,
      placeholder: '後',
      title: label + 'の後の単位',
      width: 36,
      onChange: (v) => update(afterKey, v),
    });
    afterInput.dataset.e2eId = `scriptnote-format-${prefix}-label-after`;
    const beforeGroup = gbFmt.makeGroup([gbFmt.makeLabel('前'), beforeInput]);
    const afterGroup = gbFmt.makeGroup([gbFmt.makeLabel('後'), afterInput]);
    const syncBothControls = () => {
      const hidden = posSelect.value !== 'both';
      beforeGroup.hidden = hidden;
      afterGroup.hidden = hidden;
      if (!hidden) {
        const latest = this._countConfigFieldValues(prefix);
        beforeInput.value = latest.labelBefore;
        afterInput.value = latest.labelAfter;
      }
    };
    syncBothControls();

    return [
      gbFmt.makeGroup([gbFmt.makeLabel(label, 'gb-fmt-label--group')]),
      gbFmt.makeGroup([gbFmt.makeLabel('単位'), unitInput]),
      gbFmt.makeGroup([gbFmt.makeLabel('桁'), padInput]),
      gbFmt.makeGroup([gbFmt.makeLabel('位置'), posSelect]),
      beforeGroup,
      afterGroup,
    ];
  },

  // セルスタイルポップアップ（列別スタイル編集）— openFormatPopup 経由
  _showCellStylePopup(anchorEl, chara, colId, panelContainer) {
    if (typeof openFormatPopup !== 'function') return;
    const style = this._getColStyle(chara, colId);
    const isTextCol = colId === '_text';
    const isRoleCol = colId === '_role';
    const needsLegacySync = isTextCol;
    const fields = [
      'textColor', 'fontSize', 'fontFamily',
      'bold', 'italic', 'textStrokeColor', 'textStrokeWidth',
      'bgColor', 'leftAccent', 'underline', 'accentColor',
      ...(isTextCol ? ['textBefore', 'textAfter'] : []),
      'textAlign', 'textValign', 'textOverflow',
    ];
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
      fields,
      className: 'gb-fmt-popup--cell-style',
      positionAnchor: this._detailMultiSelectionPositionAnchor(anchorEl, panelContainer),
      extraRow2: this._buildCountConfigFormatControls(colId, panelContainer),
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
        if (!chara.isDefault && isRoleCol) this._reapplyAutoColor(chara);
        this._refreshRowStyles();
        this._render();
        this._markDirty();
        refreshItem();
      },
    });
  },
