/* gb-scriptnote-ruby.js: 台本エディタ v2 — ルビタブ
   ScriptNoteEditor.prototype を拡張する */

function _snRubyIcon(name, size, fallback) {
  if (typeof lucide === 'function') return lucide(name, size || 14);
  return fallback || '';
}

function _snRubyConfirmDelete(message) {
  if (typeof cfConfirm === 'function') {
    return Promise.resolve(cfConfirm(message, { danger: true, okLabel: '削除' })).then(Boolean);
  }
  if (typeof showConfirmDialog === 'function') {
    return new Promise(resolve => showConfirmDialog(message, () => resolve(true), () => resolve(false)));
  }
  if (typeof confirm === 'function') return Promise.resolve(!!confirm(message));
  return Promise.resolve(false);
}

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
    const title = document.createElement('span');
    title.className = 'sn2-ruby-title';
    title.textContent = 'ルビ';
    header.appendChild(title);
    const headerBtns = document.createElement('div');
    headerBtns.className = 'sn2-ruby-header-actions';
    const mkBtn = (label, title, onClick, e2eId) => {
      const b = document.createElement('button');
      b.className = 'sn2-detail-add-btn gb-btn gb-btn-sm gb-btn-quiet sn2-ruby-add-rule';
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title || label);
      if (e2eId) b.dataset.e2eId = e2eId;
      const icon = document.createElement('span');
      icon.className = 'sn2-ruby-btn-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = _snRubyIcon('plus', 13, '+');
      const text = document.createElement('span');
      text.className = 'sn2-ruby-btn-label';
      text.textContent = label;
      b.append(icon, text);
      b.addEventListener('click', onClick);
      return b;
    };
    headerBtns.appendChild(mkBtn('追加', '自動ルビルール追加', () => {
      this._pushUndo('ルビルール追加');
      if (!this.doc.rubyRules) this.doc.rubyRules = [];
      this.doc.rubyRules.push({ text: '', ruby: '', auto: true });
      this._refreshAutoRubyDisplay();
      this._markDirty({ skipUndo: true });
      this.renderRubyPanel(container);
    }, 'scriptnote-ruby-add-rule'));
    header.appendChild(headerBtns);
    wrap.appendChild(header);

    // ── 表示設定セクション（ルビ一覧の上に配置） ──
    const settingsLabel = document.createElement('div');
    settingsLabel.className = 'sn2-detail-settings-label sn2-ruby-section-label';
    settingsLabel.textContent = '表示設定';
    wrap.appendChild(settingsLabel);
    const settingsWrap = document.createElement('div');
    settingsWrap.className = 'sn2-ruby-settings';
    // ルビサイズ
    const sizeRow = document.createElement('div');
    sizeRow.className = 'sn2-ruby-field';
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'sn2-ruby-field-label';
    sizeLabel.textContent = 'サイズ';
    sizeRow.appendChild(sizeLabel);
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number'; sizeInput.step = '0.05'; sizeInput.min = '0.2'; sizeInput.max = '1.5';
    sizeInput.value = this.doc.editor?.rubyFontSize || '';
    sizeInput.placeholder = '0.55';
    sizeInput.dataset.e2eId = 'scriptnote-ruby-size-input';
    sizeInput.setAttribute('aria-label', 'ルビサイズ');
    sizeInput.title = 'ルビサイズ';
    sizeInput.className = 'gb-num-input sn2-ruby-number-input';
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
    sizeUnit.className = 'sn2-ruby-unit';
    sizeUnit.textContent = 'em';
    sizeRow.appendChild(sizeUnit);
    settingsWrap.appendChild(sizeRow);
    // テキストとの距離（サイズの横に並べる）
    const offsetRow = document.createElement('div');
    offsetRow.className = 'sn2-ruby-field';
    const offsetLabel = document.createElement('span');
    offsetLabel.className = 'sn2-ruby-field-label';
    offsetLabel.textContent = '距離';
    offsetRow.appendChild(offsetLabel);
    const offsetInput = document.createElement('input');
    offsetInput.type = 'number'; offsetInput.step = '1'; offsetInput.min = '-10'; offsetInput.max = '20';
    offsetInput.value = this.doc.editor?.rubyOffset ?? '';
    offsetInput.placeholder = '3.5';
    offsetInput.dataset.e2eId = 'scriptnote-ruby-offset-input';
    offsetInput.setAttribute('aria-label', 'ルビ距離');
    offsetInput.title = 'ルビ距離';
    offsetInput.className = 'gb-num-input sn2-ruby-number-input';
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
    offsetUnit.className = 'sn2-ruby-unit';
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
      secLabel.className = 'sn2-detail-settings-label sn2-ruby-section-label';
      secLabel.textContent = `ファイル内ルビ（${fileRubies.length}件）`;
      wrap.appendChild(secLabel);
      const table = document.createElement('table');
      table.className = 'sn2-ruby-table';
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['対象', 'ルビ', '位置'].forEach((text, index) => {
        const th = document.createElement('th');
        th.textContent = text;
        if (index === 2) th.className = 'sn2-ruby-file-pos';
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      fileRubies.forEach((fr, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'sn2-ruby-file-row';
        tr.tabIndex = 0;
        tr.setAttribute('role', 'button');
        tr.setAttribute('aria-label', `${fr.text} のルビ位置へ移動`);
        tr.dataset.e2eId = 'scriptnote-ruby-file-row-' + idx;
        const baseCell = document.createElement('td');
        baseCell.textContent = fr.text;
        const rubyCell = document.createElement('td');
        rubyCell.className = 'sn2-ruby-file-ruby';
        rubyCell.textContent = fr.ruby;
        const posCell = document.createElement('td');
        posCell.className = 'sn2-ruby-file-pos';
        posCell.textContent = fr.role || '行' + (fr.rowIdx + 1);
        tr.append(baseCell, rubyCell, posCell);
        const jumpToRubyRow = () => {
          const row = this.doc.rows[fr.rowIdx];
          if (row) {
            const safeRowId = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
              ? CSS.escape(row.id)
              : String(row.id).replace(/["\\]/g, '\\$&');
            const rowEl = this.host?.querySelector(`.sn2-row[data-row-id="${safeRowId}"]`);
            if (rowEl) {
              rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              rowEl.classList.add('sn2-swap-highlight');
              setTimeout(() => rowEl.classList.remove('sn2-swap-highlight'), 600);
            }
          }
        };
        tr.addEventListener('click', jumpToRubyRow);
        tr.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          jumpToRubyRow();
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      const tableWrap = document.createElement('div');
      tableWrap.className = 'sn2-ruby-table-wrap';
      tableWrap.appendChild(table);
      wrap.appendChild(tableWrap);
    }

    // ── 自動ルビルール（テーブル形式） ──
    const autoLabel = document.createElement('div');
    autoLabel.className = 'sn2-detail-settings-label sn2-ruby-section-label sn2-ruby-section-label--ruled';
    autoLabel.textContent = `自動ルビルール（${autoRules.length}件）`;
    wrap.appendChild(autoLabel);

    const ruleList = document.createElement('div');
    ruleList.className = 'sn2-detail-list';
    autoRules.forEach((rule, i) => {
      const item = document.createElement('div');
      item.className = 'sn2-detail-item sn2-ruby-rule-item';
      item.draggable = true;
      item.dataset.idx = i;

      const handle = document.createElement('span');
      handle.className = 'sn2-detail-handle sn2-ruby-rule-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.textContent = '⠿';
      item.appendChild(handle);

      const textInp = document.createElement('input');
      textInp.type = 'text';
      textInp.value = rule.text || '';
      textInp.placeholder = '漢字';
      textInp.dataset.e2eId = 'scriptnote-ruby-rule-text-' + i;
      textInp.setAttribute('aria-label', '自動ルビ対象 ' + (i + 1));
      textInp.title = '自動ルビ対象';
      textInp.className = 'gb-input-sm sn2-ruby-rule-input';
      textInp.addEventListener('change', () => {
        this._pushUndo('ルビルール編集');
        rule.text = textInp.value.trim();
        this._refreshAutoRubyDisplay();
        this._markDirty({ skipUndo: true });
      });
      item.appendChild(textInp);

      const arrow = document.createElement('span');
      arrow.textContent = '→';
      arrow.className = 'sn2-ruby-rule-arrow';
      item.appendChild(arrow);

      const rubyInp = document.createElement('input');
      rubyInp.type = 'text';
      rubyInp.value = rule.ruby || '';
      rubyInp.placeholder = 'ルビ';
      rubyInp.dataset.e2eId = 'scriptnote-ruby-rule-ruby-' + i;
      rubyInp.setAttribute('aria-label', '自動ルビ ' + (i + 1));
      rubyInp.title = '自動ルビ';
      rubyInp.className = 'gb-input-sm sn2-ruby-rule-input';
      rubyInp.addEventListener('change', () => {
        this._pushUndo('ルビルール編集');
        rule.ruby = rubyInp.value.trim();
        this._refreshAutoRubyDisplay();
        this._markDirty({ skipUndo: true });
      });
      item.appendChild(rubyInp);

      // 削除ボタン（右端固定、改行しない）
      const delBtn = document.createElement('button');
      delBtn.className = 'gb-btn gb-btn-xs gb-btn-icon gb-btn-quiet sn2-ruby-delete-rule';
      delBtn.type = 'button';
      delBtn.title = '削除';
      delBtn.dataset.e2eId = 'scriptnote-ruby-rule-delete-' + i;
      delBtn.setAttribute('aria-label', '自動ルビルールを削除 ' + (i + 1));
      delBtn.innerHTML = _snRubyIcon('trash2', 13, '削除');
      delBtn.addEventListener('click', async () => {
        const ok = await _snRubyConfirmDelete(`ルビルール「${rule.text || '(空)'}→${rule.ruby || '(空)'}」を削除しますか？`);
        if (!ok) return;
        this._pushUndo('ルビルール削除');
        autoRules.splice(i, 1);
        this._refreshAutoRubyDisplay();
        this._markDirty({ skipUndo: true });
        this.renderRubyPanel(container);
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
    const clearDragState = () => {
      dragIdx = -1;
      listEl.querySelectorAll('.sn2-detail-item').forEach(el => el.classList.remove('sn2-dragging', 'sn2-drop-above', 'sn2-drop-below'));
    };
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
      clearDragState();
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const item = e.target.closest('.sn2-detail-item');
      if (!item || dragIdx < 0) { clearDragState(); return; }
      const rules = this.doc.rubyRules || [];
      let dropIdx = Number(item.dataset.idx);
      const rect = item.getBoundingClientRect();
      if (e.clientY >= rect.top + rect.height / 2) dropIdx++;
      if (dropIdx === dragIdx || dropIdx === dragIdx + 1) { clearDragState(); return; }
      this._pushUndo('ルビルール並び替え');
      const [moved] = rules.splice(dragIdx, 1);
      rules.splice(dropIdx > dragIdx ? dropIdx - 1 : dropIdx, 0, moved);
      this._refreshAutoRubyDisplay();
      this._markDirty({ skipUndo: true });
      clearDragState();
      this.renderRubyPanel(panelContainer);
    });
  },

  _escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

});
