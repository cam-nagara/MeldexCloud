      }
      this._markDirty();
    });
    wrap.appendChild(settings);
    const statusEnabled = !!this.doc.editor?.statusEnabled;
    const statusSection = document.createElement('div');
    statusSection.className = 'sn2-detail-settings sn2-detail-settings--spaced';
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
    addBtn.dataset.e2eId = 'scriptnote-theme-add-status';
    addBtn.title = '採用状況を追加';
    addBtn.setAttribute('aria-label', '採用状況を追加');
    addBtn.disabled = !statusEnabled;
    statusBar.appendChild(enabledLabel);
    statusBar.appendChild(addBtn);
    statusSection.appendChild(statusBar);
    const statusListWrap = document.createElement('div');
    statusListWrap.className = 'sn2-detail-status-list';
    (this._getStatusList ? this._getStatusList() : []).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'sn2-detail-settings-row sn2-detail-settings-row--center';
      row.innerHTML = `
        <button type="button" class="gb-fmt-swatch gb-fmt-swatch-bg gb-fmt-swatch--xs" data-status-color="${index}" title="色"></button>
        <input type="text" class="sn2-detail-settings-input sn2-detail-settings-input--status-name" data-status-name="${index}" value="${typeof esc === 'function' ? esc(item.name) : item.name}" placeholder="名称"${statusEnabled ? '' : ' disabled'}>
        <button type="button" class="sn2-detail-add-btn" data-status-delete="${index}"${statusEnabled ? '' : ' disabled'}>削除</button>`;
      statusListWrap.appendChild(row);
      const sw = row.querySelector('[data-status-color]');
      if (sw) sw.style.background = item.color || 'var(--bg3)';
    });
    statusSection.appendChild(statusListWrap);
    addBtn.addEventListener('click', () => {
      this._pushUndo('採用状況設定変更');
      const list = this._getStatusList();
      const usedNames = new Set(list.map(item => String(item?.name || '').trim()).filter(Boolean));
      let nextIndex = list.length + 1;
      let nextName = `状態${nextIndex}`;
      while (usedNames.has(nextName)) {
        nextIndex++;
        nextName = `状態${nextIndex}`;
      }
      list.push({ name: nextName, color: SCRIPTNOTE_DEFAULT_STATUS_LIST[list.length % SCRIPTNOTE_DEFAULT_STATUS_LIST.length].color });
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
        const removeStatus = () => {
          this._pushUndo('採用状況設定変更');
          const removed = list.splice(idx, 1)[0];
          this.doc.editor.statusList = _sn2NormalizeStatusList(list);
          this._clearInvalidStatuses?.(removed?.name || '');
          this._markDirty();
          this._render();
          this.renderThemePanel(container);
        };
        const name = list[idx].name || `状態${idx + 1}`;
        if (typeof showConfirmDialog === 'function') showConfirmDialog(`採用状況「${name}」を削除しますか？`, removeStatus);
        else if (typeof window === 'undefined' || window.confirm(`採用状況「${name}」を削除しますか？`)) removeStatus();
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
          cb.setAttribute('aria-label', cb.title);
          cb.dataset.e2eId = 'scriptnote-theme-column-border-' + String(col.id).replace(/[^a-zA-Z0-9_-]/g, '_');
          cb.dataset.columnBorderLeft = col.id;
          cb.dataset.columnBorderRight = allCols[i + 1].id;
          cb.className = 'sn2-detail-colborder-cb';
          const hit = document.createElement('label');
          hit.className = 'sn2-detail-colborder-hit';
          hit.title = cb.title;
          hit.setAttribute('aria-label', cb.title);
          cb.addEventListener('change', () => {
            this._pushUndo('列間枠線変更');
            const newSet = this._getColumnBorderSet();
            if (cb.checked) newSet.add(col.id); else newSet.delete(col.id);
            this.doc.editor.columnBorders = Array.from(newSet);
            this._markDirty();
            this._render();
          });
          hit.appendChild(cb);
          colBorderUI.appendChild(hit);
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
    const acSelOpt = (val, cur) => val === cur ? ' selected' : '';
    const acRule = this.doc.editor?.autoColorRule || {};
    const acPaletteRow = typeof this._getAutoColorPaletteRow === 'function' ? this._getAutoColorPaletteRow() : 3;
    const acPaletteRowEl = document.createElement('div');
    acPaletteRowEl.className = 'sn2-detail-settings-row';
    acPaletteRowEl.innerHTML = `
      <label class="sn2-detail-settings-label">テーマカラー</label>
      <select class="sn2-detail-settings-select" data-ac-palette-row data-e2e-id="scriptnote-theme-auto-color-palette-row" title="自動配色で繰り返すテーマカラーの行">
        <option value="1"${acSelOpt(1, acPaletteRow)}>1行目</option>
        <option value="2"${acSelOpt(2, acPaletteRow)}>2行目</option>
        <option value="3"${acSelOpt(3, acPaletteRow)}>3行目</option>
        <option value="4"${acSelOpt(4, acPaletteRow)}>4行目</option>
      </select>`;
    acSection.appendChild(acPaletteRowEl);
    acSection.appendChild(acHeader);
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
      const paletteRowSel = ev.target.closest('[data-ac-palette-row]');
      if (paletteRowSel) {
        this._pushUndo('自動配色変更');
        const nextRow = Math.max(1, Math.min(4, parseInt(paletteRowSel.value, 10) || 3));
        if (!this.doc.editor) this.doc.editor = {};
        this.doc.editor.autoColorPaletteRow = nextRow;
        this._resetAutoColorPaletteAssignments();
        this._refreshRowStyles();
        this._markDirty();
        return;
      }
      const sel = ev.target.closest('[data-ac-col]');
      if (!sel) return;
      this._pushUndo('自動配色変更');
      if (!this.doc.editor.autoColorRule) this.doc.editor.autoColorRule = {};
      const colId = sel.dataset.acCol;
      this.doc.editor.autoColorRule[colId] = sel.value;
      const rule = {};
      colDefs.forEach(cd => { rule[cd.id] = this.doc.editor.autoColorRule[cd.id] || 'none'; });
      this.doc.editor.autoColorRule = { ...rule };
      // すべての非デフォルトタイプに同じターゲットを適用
      this._getAutoColorAppearanceTargets().forEach(appearance => {
        appearance.autoColorTarget = { ...rule };
        if (typeof this._reapplyAutoColor === 'function') this._reapplyAutoColor(appearance);
      });
      this._refreshRowStyles();
      this._markDirty();
    });
    wrap.appendChild(acSection);

    container.appendChild(wrap);
  },

});
