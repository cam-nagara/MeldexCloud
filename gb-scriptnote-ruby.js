/* gb-scriptnote-ruby.js: 台本エディタ v2 — ルビタブ
   ScriptNoteEditor.prototype を拡張する */

Object.assign(ScriptNoteEditor.prototype, {

  _refreshAutoRubyDisplay() {
    this.host?.querySelectorAll('.sn2-text').forEach((textEl) => {
      if (typeof this._applyAutoRuby === 'function') this._applyAutoRuby(textEl);
    });
    if (typeof this._adjustRubySpacing === 'function') this._adjustRubySpacing();
  },

  renderRubyPanel(container) {
    if (!container || !this.doc) return;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'sn2-ruby-panel';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'sn2-detail-header';
    header.innerHTML = '<span style="font-weight:600;font-size:13px;">ルビ</span>';
    const headerBtns = document.createElement('div');
    headerBtns.style.cssText = 'display:flex;gap:3px;';
    const mkBtn = (label, title, onClick) => {
      const b = document.createElement('button');
      b.className = 'sn2-detail-add-btn';
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };
    headerBtns.appendChild(mkBtn('＋追加', '自動ルビルール追加', () => {
      this._pushUndo('ルビルール追加');
      if (!this.doc.rubyRules) this.doc.rubyRules = [];
      this.doc.rubyRules.push({ text: '', ruby: '', auto: true });
      this._refreshAutoRubyDisplay();
      this._markDirty({ skipUndo: true });
      this.renderRubyPanel(container);
    }));
    header.appendChild(headerBtns);
    wrap.appendChild(header);

    // ── 表示設定セクション（ルビ一覧の上に配置） ──
    const settingsLabel = document.createElement('div');
    settingsLabel.className = 'sn2-detail-settings-label';
    settingsLabel.style.cssText = 'padding:8px 12px 4px;font-weight:600;';
    settingsLabel.textContent = '表示設定';
    wrap.appendChild(settingsLabel);
    const settingsWrap = document.createElement('div');
    settingsWrap.style.cssText = 'padding:4px 12px 8px;display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--border);';
    // ルビサイズ
    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const sizeLabel = document.createElement('span');
    sizeLabel.style.cssText = 'font-size:11px;color:var(--fg2);';
    sizeLabel.textContent = 'サイズ';
    sizeRow.appendChild(sizeLabel);
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number'; sizeInput.step = '0.05'; sizeInput.min = '0.2'; sizeInput.max = '1.5';
    sizeInput.value = this.doc.editor?.rubyFontSize || '';
    sizeInput.placeholder = '0.55';
    sizeInput.style.cssText = 'width:52px;font-size:10px;padding:1px 3px;border:1px solid var(--border);border-radius:2px;background:var(--bg);color:var(--fg);';
    sizeInput.addEventListener('change', () => {
      this._pushUndo('ルビサイズ変更');
      if (!this.doc.editor) this.doc.editor = {};
      const v = parseFloat(sizeInput.value);
      this.doc.editor.rubyFontSize = (v && v >= 0.2 && v <= 1.5) ? v : null;
      // .sn2-scroll は host の子孫なので closest ではなく querySelector で取得する
      const scroll = this.host?.querySelector('.sn2-scroll');
      if (scroll) scroll.style.setProperty('--sn2-ruby-size', this.doc.editor.rubyFontSize ? this.doc.editor.rubyFontSize + 'em' : '');
      this._adjustRubySpacing();
      this._markDirty({ skipUndo: true });
    });
    sizeRow.appendChild(sizeInput);
    const sizeUnit = document.createElement('span');
    sizeUnit.style.cssText = 'font-size:10px;color:var(--fg2);';
    sizeUnit.textContent = 'em';
    sizeRow.appendChild(sizeUnit);
    settingsWrap.appendChild(sizeRow);
    // テキストとの距離（サイズの横に並べる）
    const offsetRow = document.createElement('div');
    offsetRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const offsetLabel = document.createElement('span');
    offsetLabel.style.cssText = 'font-size:11px;color:var(--fg2);';
    offsetLabel.textContent = '距離';
    offsetRow.appendChild(offsetLabel);
    const offsetInput = document.createElement('input');
    offsetInput.type = 'number'; offsetInput.step = '1'; offsetInput.min = '-10'; offsetInput.max = '20';
    offsetInput.value = this.doc.editor?.rubyOffset ?? '';
    offsetInput.placeholder = '3.5';
    offsetInput.style.cssText = 'width:52px;font-size:10px;padding:1px 3px;border:1px solid var(--border);border-radius:2px;background:var(--bg);color:var(--fg);';
    offsetInput.addEventListener('change', () => {
      this._pushUndo('ルビ距離変更');
      if (!this.doc.editor) this.doc.editor = {};
      const v = parseFloat(offsetInput.value);
      this.doc.editor.rubyOffset = (!isNaN(v) && v >= -10 && v <= 20) ? v : null;
      // .sn2-scroll は host の子孫なので closest ではなく querySelector で取得する
      const scroll = this.host?.querySelector('.sn2-scroll');
      if (scroll) scroll.style.setProperty('--sn2-ruby-offset', this.doc.editor.rubyOffset != null ? this.doc.editor.rubyOffset + 'px' : '');
      this._markDirty({ skipUndo: true });
    });
    offsetRow.appendChild(offsetInput);
    const offsetUnit = document.createElement('span');
    offsetUnit.style.cssText = 'font-size:10px;color:var(--fg2);';
    offsetUnit.textContent = 'px';
    offsetRow.appendChild(offsetUnit);
    settingsWrap.appendChild(offsetRow);
    wrap.appendChild(settingsWrap);

    // ── ファイル内ルビ一覧（テーブル形式） ──
    // gb-scriptnote-editor.js の _sn2NewRubyRegex / _sn2UnescapeRubyText を利用
    const fileRubies = [];
    this.doc.rows.forEach((r, i) => {
      if (!r.text) return;
      const re = typeof _sn2NewRubyRegex === 'function'
        ? _sn2NewRubyRegex()
        : /\{([^|{}]+)\|([^|{}]+)\}/g;
      const unescape = typeof _sn2UnescapeRubyText === 'function' ? _sn2UnescapeRubyText : (s => s);
      let m;
      while ((m = re.exec(r.text)) !== null) {
        fileRubies.push({ text: unescape(m[1]), ruby: unescape(m[2]), rowIdx: i, role: r.role });
      }
    });

    const autoRules = Array.isArray(this.doc.rubyRules) ? this.doc.rubyRules : [];

    if (fileRubies.length) {
      const secLabel = document.createElement('div');
      secLabel.className = 'sn2-detail-settings-label';
      secLabel.style.cssText = 'padding:8px 12px 4px;font-weight:600;';
      secLabel.textContent = `ファイル内ルビ（${fileRubies.length}件）`;
      wrap.appendChild(secLabel);
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr style="color:var(--fg2);font-size:10px;border-bottom:1px solid var(--border);"><th style="padding:2px 8px;text-align:left;">対象</th><th style="padding:2px 4px;text-align:left;">ルビ</th><th style="padding:2px 8px;text-align:right;">位置</th></tr>';
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      fileRubies.forEach(fr => {
        const tr = document.createElement('tr');
        tr.style.cssText = 'cursor:pointer;border-bottom:1px solid var(--border);';
        tr.innerHTML = `<td style="padding:3px 8px;">${this._escHtml(fr.text)}</td>
          <td style="padding:3px 4px;color:var(--fg2);">${this._escHtml(fr.ruby)}</td>
          <td style="padding:3px 8px;text-align:right;color:var(--fg2);font-size:10px;">${this._escHtml(fr.role || '行' + (fr.rowIdx + 1))}</td>`;
        tr.addEventListener('click', () => {
          const row = this.doc.rows[fr.rowIdx];
          if (row) {
            const rowEl = this.host?.querySelector(`.sn2-row[data-row-id="${row.id}"]`);
            if (rowEl) {
              rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              rowEl.classList.add('sn2-swap-highlight');
              setTimeout(() => rowEl.classList.remove('sn2-swap-highlight'), 600);
            }
          }
        });
        tr.addEventListener('pointerenter', () => { tr.style.background = 'var(--bg3)'; });
        tr.addEventListener('pointerleave', () => { tr.style.background = ''; });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      const tableWrap = document.createElement('div');
      tableWrap.style.cssText = 'max-height:200px;overflow-y:auto;padding:0 4px;';
      tableWrap.appendChild(table);
      wrap.appendChild(tableWrap);
    }

    // ── 自動ルビルール（テーブル形式） ──
    const autoLabel = document.createElement('div');
    autoLabel.className = 'sn2-detail-settings-label';
    autoLabel.style.cssText = 'padding:8px 12px 4px;font-weight:600;border-top:1px solid var(--border);';
    autoLabel.textContent = `自動ルビルール（${autoRules.length}件）`;
    wrap.appendChild(autoLabel);

    const ruleList = document.createElement('div');
    ruleList.className = 'sn2-detail-list';
    autoRules.forEach((rule, i) => {
      const item = document.createElement('div');
      item.className = 'sn2-detail-item';
      item.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 8px;min-height:32px;';
      item.draggable = true;
      item.dataset.idx = i;

      const handle = document.createElement('span');
      handle.className = 'sn2-detail-handle';
      handle.textContent = '⠿';
      item.appendChild(handle);

      const textInp = document.createElement('input');
      textInp.type = 'text';
      textInp.value = rule.text || '';
      textInp.placeholder = '漢字';
      textInp.style.cssText = 'flex:1;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--fg);font-size:12px;outline:none;min-width:0;';
      textInp.addEventListener('change', () => {
        this._pushUndo('ルビルール編集');
        rule.text = textInp.value.trim();
        this._refreshAutoRubyDisplay();
        this._markDirty({ skipUndo: true });
      });
      item.appendChild(textInp);

      const arrow = document.createElement('span');
      arrow.textContent = '→';
      arrow.style.cssText = 'color:var(--fg2);font-size:11px;flex-shrink:0;';
      item.appendChild(arrow);

      const rubyInp = document.createElement('input');
      rubyInp.type = 'text';
      rubyInp.value = rule.ruby || '';
      rubyInp.placeholder = 'ルビ';
      rubyInp.style.cssText = 'flex:1;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--fg);font-size:12px;outline:none;min-width:0;';
      rubyInp.addEventListener('change', () => {
        this._pushUndo('ルビルール編集');
        rule.ruby = rubyInp.value.trim();
        this._refreshAutoRubyDisplay();
        this._markDirty({ skipUndo: true });
      });
      item.appendChild(rubyInp);

      // 削除ボタン（右端固定、改行しない）
      const delBtn = document.createElement('button');
      delBtn.className = 'gb-fmt-btn';
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.title = '削除';
      delBtn.style.cssText = 'font-size:10px;color:var(--fg2);flex-shrink:0;margin-left:auto;';
      delBtn.addEventListener('click', () => {
        showConfirmDialog(`ルビルール「${rule.text || '(空)'}→${rule.ruby || '(空)'}」を削除しますか？`, () => {
          this._pushUndo('ルビルール削除');
          autoRules.splice(i, 1);
          this._refreshAutoRubyDisplay();
          this._markDirty({ skipUndo: true });
          this.renderRubyPanel(container);
        });
      });
      item.appendChild(delBtn);

      ruleList.appendChild(item);
    });
    wrap.appendChild(ruleList);

    // D&D for auto rules
    this._setupRubyDragDrop(ruleList, container);

    container.appendChild(wrap);
  },

  _setupRubyDragDrop(listEl, panelContainer) {
    let dragIdx = -1;
    listEl.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.sn2-detail-item');
      if (!item) return;
      dragIdx = Number(item.dataset.idx);
      item.classList.add('sn2-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      listEl.querySelectorAll('.sn2-detail-item').forEach(el => el.classList.remove('sn2-drop-above', 'sn2-drop-below'));
      const item = e.target.closest('.sn2-detail-item');
      if (item) {
        const rect = item.getBoundingClientRect();
        item.classList.toggle('sn2-drop-above', e.clientY < rect.top + rect.height / 2);
        item.classList.toggle('sn2-drop-below', e.clientY >= rect.top + rect.height / 2);
      }
    });
    listEl.addEventListener('dragend', () => {
      listEl.querySelectorAll('.sn2-detail-item').forEach(el => el.classList.remove('sn2-dragging', 'sn2-drop-above', 'sn2-drop-below'));
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const item = e.target.closest('.sn2-detail-item');
      if (!item || dragIdx < 0) return;
      const rules = this.doc.rubyRules || [];
      let dropIdx = Number(item.dataset.idx);
      const rect = item.getBoundingClientRect();
      if (e.clientY >= rect.top + rect.height / 2) dropIdx++;
      if (dropIdx === dragIdx || dropIdx === dragIdx + 1) return;
      this._pushUndo('ルビルール並び替え');
      const [moved] = rules.splice(dragIdx, 1);
      rules.splice(dropIdx > dragIdx ? dropIdx - 1 : dropIdx, 0, moved);
      this._refreshAutoRubyDisplay();
      this._markDirty({ skipUndo: true });
      this.renderRubyPanel(panelContainer);
    });
  },

  _escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

});
