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
      positionAnchor: this._detailMultiSelectionPositionAnchor?.(anchorEl, panelContainer),
      extraRow2: this._buildCountConfigFormatControls(colId, panelContainer),
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
    const textShiftColsValue = Number.isFinite(Number(chara.textShiftCols)) ? Math.max(1, Math.min(10, Number(chara.textShiftCols))) : '';
    const outlineWidthValue = Number.isFinite(Number(chara.outlineWidth)) ? Math.max(0.5, Math.min(10, Number(chara.outlineWidth))) : 1;
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
          <input type="number" class="sn2-role-opts-input-num sn2-role-opts-input-num--sm" data-opt="textShiftCols" value="${e(textShiftColsValue)}" placeholder="1" min="1" max="10">
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
            <input type="number" class="sn2-role-opts-input-num sn2-role-opts-input-num--sm" data-opt="outlineWidth" value="${e(outlineWidthValue)}" placeholder="1" min="0.5" max="10" step="0.5">
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
      dup.name = this._uniqueRoleName((chara.name || 'タイプ') + '（コピー）', chara);
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
        this._calcCache = null;
        this._render();
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
        if (key === 'isBreak' && cb.checked) {
          chara.isSummary = false;
          const summaryCb = popup.querySelector('[data-opt-check="isSummary"]');
          if (summaryCb) summaryCb.checked = false;
        } else if (key === 'isBreak' && !cb.checked) {
          chara.isSpread = false;
          const spreadCb = popup.querySelector('[data-opt-check="isSpread"]');
          if (spreadCb) spreadCb.checked = false;
        } else if (key === 'isSummary' && cb.checked) {
          chara.isBreak = false;
          chara.isSpread = false;
          const breakCb = popup.querySelector('[data-opt-check="isBreak"]');
          const spreadCb = popup.querySelector('[data-opt-check="isSpread"]');
          if (breakCb) breakCb.checked = false;
          if (spreadCb) spreadCb.checked = false;
        } else if (key === 'isSpread' && cb.checked && !chara.isBreak) {
          chara.isSpread = false;
          cb.checked = false;
          if (typeof showStatus === 'function') showStatus('見開きは区切りタイプでのみ使えます', true);
        }
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

  _uniqueRoleName(baseName, excludeChara = null) {
    const base = String(baseName || '').trim() || '新しいタイプ';
    const used = new Set((this.doc?.characters || [])
      .filter(c => c && c !== excludeChara && !c.isDefault)
      .map(c => String(c.name || '').trim())
      .filter(Boolean));
    if (!used.has(base)) return base;
    let index = 2;
    let candidate = `${base}（${index}）`;
    while (used.has(candidate)) {
      index++;
      candidate = `${base}（${index}）`;
    }
    return candidate;
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
  _getAutoColorPaletteRow() {
    const raw = Number(this.doc?.editor?.autoColorPaletteRow);
    return Number.isFinite(raw) ? Math.max(1, Math.min(4, Math.round(raw))) : 3;
  },

  _getAutoColorPalette() {
    const row = this._getAutoColorPaletteRow();
    if (typeof getStandardPaletteSwatches === 'function') {
      const colors = getStandardPaletteSwatches(undefined, { themeSlots: true })
        .filter(swatch => swatch && swatch.row === row && swatch.color && swatch.color !== 'transparent')
        .map(swatch => swatch.color);
      if (colors.length) return colors;
    }
    const fallback = typeof PALETTE_COLORS !== 'undefined' ? PALETTE_COLORS : [];
    const ranges = { 1: [0, 7], 2: [7, 15], 3: [15, 23], 4: [23, 31] };
    const [start, end] = ranges[row] || ranges[3];
    const colors = fallback.slice(start, end).filter(Boolean);
    return colors.length ? colors : fallback.filter(Boolean);
  },

  _reapplyAutoColor(chara) {
    if (!chara) return;
    const acRule = this.doc.editor?.autoColorRule || {};
    const allNone = Object.values(acRule).every(v => !v || v === 'none');
    if (allNone) { delete chara.autoColor; return; }
    // autoColorが未設定なら再割り当て
    if (!chara.autoColor) {
      const colors = this._getAutoColorPalette();
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
    this._calcCache = null;
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
    const clearDragState = () => {
      dragIdx = -1;
      listEl.querySelectorAll('.sn2-detail-item').forEach(el => {
        el.classList.remove('sn2-dragging', 'sn2-drop-above', 'sn2-drop-below');
      });
    };
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
      clearDragState();
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const item = e.target.closest('.sn2-detail-item');
      if (!item || dragIdx < 0) { clearDragState(); return; }
      // デフォルト行はドラッグ元・ドロップ先のいずれでも対象外（末尾固定）
      if (this.doc.characters[dragIdx]?.isDefault) { clearDragState(); return; }
      let dropIdx = Number(item.dataset.idx);
      const rect = item.getBoundingClientRect();
      if (e.clientY >= rect.top + rect.height / 2) dropIdx++;
      if (dropIdx === dragIdx || dropIdx === dragIdx + 1) { clearDragState(); return; }
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
      dragIdx = -1;
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
    const borderMode = this.doc.editor?.borderMode || 'all';
    const borderColor = this.doc.editor?.borderColor || '';
    const borderWidth = this.doc.editor?.borderWidth || '';
    const parsedBorderWidth = parseFloat(borderWidth);
    const borderWidthValue = Number.isFinite(parsedBorderWidth) ? String(parsedBorderWidth) : '';
    const editorMargin = this.doc.editor?.margin || '';
    const mergeDisp = !!this.doc.editor?.mergeDisplay;
    const pageBreakSpacing = this.doc.editor?.pageBreakSpacing !== false;
    const rawWheelSpeed = parseFloat(localStorage.getItem('meldex-wheel-speed'));
    const wheelSpeed = Number.isFinite(rawWheelSpeed) && rawWheelSpeed > 0
      ? Math.max(0.5, Math.min(5, rawWheelSpeed))
      : 2.5;
    const selOpt = (val, cur) => val === cur ? ' selected' : '';
    const clampNumberText = (value, fallback, min, max) => {
      const num = Number(value);
      const next = Number.isFinite(num) ? num : fallback;
      return String(Math.max(min, Math.min(max, next)));
    };
    const settings = document.createElement('div');
    settings.className = 'sn2-detail-settings';
    const spreadBorderStartValue = clampNumberText(this.doc.editor?.spreadBorder?.start, 1, 1, 999);
    const spreadBorderEveryValue = clampNumberText(this.doc.editor?.spreadBorder?.every, 2, 1, 99);
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
        <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg gb-fmt-swatch--xs" data-setting-color="borderColor" data-e2e-id="scriptnote-theme-border-color" title="枠線の色" aria-label="枠線の色"></button>
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
        <label class="sn2-detail-settings-label sn2-detail-settings-label--mr2">
          <input type="checkbox" data-setting="pageBreakSpacing" data-e2e-id="scriptnote-theme-page-break-spacing" title="区切り行の前に1行分の余白を表示" aria-label="ページ間を空ける" ${pageBreakSpacing ? ' checked' : ''}> ページ間を空ける
        </label>
      </div>
      <div class="sn2-detail-settings-row" style="flex-wrap:nowrap;">
        <label class="sn2-detail-settings-label">ホイール速度</label>
        <input type="range" class="gb-range" style="min-width:120px;flex:1;" min="0.5" max="5" step="0.1" value="${e(wheelSpeed.toFixed(1))}" data-sn2-wheel-speed data-e2e-id="scriptnote-theme-wheel-speed" title="ホイール速度" aria-label="ホイール速度">
        <span class="sn2-detail-settings-label sn2-detail-settings-label--ml0" style="width:48px;text-align:right;" data-sn2-wheel-speed-value>${e(wheelSpeed.toFixed(1))}倍</span>
      </div>
      <div class="sn2-detail-settings-row">
        <label class="sn2-detail-settings-label sn2-detail-settings-label--mr2">
          <input type="checkbox" data-setting="spreadBorderEnabled"${this.doc.editor?.spreadBorder?.enabled ? ' checked' : ''}> 見開き区切り
        </label>
        <label class="sn2-detail-settings-label">開始</label>
        <input type="number" class="sn2-detail-settings-input sn2-detail-settings-input--w36" data-setting="spreadBorderStart" value="${e(spreadBorderStartValue)}" min="1" max="999" title="区切り線を引く最初のページ番号">
        <label class="sn2-detail-settings-label">間隔</label>
        <input type="number" class="sn2-detail-settings-input sn2-detail-settings-input--w36" data-setting="spreadBorderEvery" value="${e(spreadBorderEveryValue)}" min="1" max="99" title="何ページごとに区切り線を引くか">
        <span class="sn2-detail-settings-label">p</span>
      </div>
      <div class="sn2-detail-settings-row">
        <label class="sn2-detail-settings-label">列間枠線</label>
        <div id="sn2-col-border-ui" class="sn2-detail-colborder-ui"></div>
      </div>`;
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
      } else if (key === 'pageBreakSpacing') {
        this.doc.editor.pageBreakSpacing = el.checked;
        this._render();
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
      } else {
        return;
