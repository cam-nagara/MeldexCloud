/* gb-scriptnote-status.js: シナリオ行ステータス */

const SCRIPTNOTE_DEFAULT_STATUS_LIST = [
  { name: '案', color: '#ce9178' },
  { name: '採用', color: '#6fa8dc' },
  { name: 'ボツ', color: '#969696' },
  { name: '掲載済み', color: '#6a9955' },
];

function _sn2CloneStatusList(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    name: String(item?.name || ''),
    color: String(item?.color || ''),
  }));
}

function _sn2NormalizeStatusList(list) {
  const fallback = _sn2CloneStatusList(SCRIPTNOTE_DEFAULT_STATUS_LIST);
  const src = Array.isArray(list) && list.length ? list : fallback;
  const next = [];
  const seen = new Set();
  src.forEach((item, idx) => {
    const name = String(item?.name || '').trim() || `状態${idx + 1}`;
    if (seen.has(name)) return;
    seen.add(name);
    const color = String(item?.color || fallback[idx % fallback.length]?.color || '#6fa8dc');
    next.push({ name, color });
  });
  return next.length ? next : fallback;
}

Object.assign(ScriptNoteEditor.prototype, {

  _syncFilterButtonState() {
    const root = this.host?.closest?.('.gb-se-root');
    const btn = root?.querySelector?.('#btn-filter');
    const sel = root?.querySelector?.('#sn-filter-preset');
    const statusEnabled = !!this.doc?.editor?.statusEnabled;
    const hasAny = !!this._filterRoles
      || !!(this._hideRoles && this._hideRoles.size)
      || (statusEnabled && !!this._filterStatuses)
      || (statusEnabled && !!(this._hideStatuses && this._hideStatuses.size));
    if (btn) btn.classList.toggle('active', hasAny);
    if (sel && !hasAny) sel.value = '__all__';
  },

  _ensureStatusConfig() {
    if (!this.doc) return [];
    if (!this.doc.editor) this.doc.editor = {};
    if (this.doc.editor.statusEnabled !== true) this.doc.editor.statusEnabled = false;
    this.doc.editor.statusList = _sn2NormalizeStatusList(this.doc.editor.statusList);
    return this.doc.editor.statusList;
  },

  _getStatusList() {
    return this._ensureStatusConfig();
  },

  _clearInvalidStatuses(names = null) {
    if (!this.doc?.rows) return;
    const validNames = new Set(this._getStatusList().map((item) => item.name));
    const removeNames = names
      ? new Set((Array.isArray(names) ? names : [names]).map((item) => String(item || '').trim()).filter(Boolean))
      : null;
    this.doc.rows.forEach((row) => {
      const status = String(row?.status || '').trim();
      if (!status) return;
      if ((removeNames && removeNames.has(status)) || (!removeNames && !validNames.has(status))) delete row.status;
    });
    if (this._filterStatuses?.size) {
      this._filterStatuses.forEach((status) => {
        if (!validNames.has(status)) this._filterStatuses.delete(status);
      });
      if (!this._filterStatuses.size) this._filterStatuses = null;
    }
    if (this._hideStatuses?.size) {
      this._hideStatuses.forEach((status) => {
        if (!validNames.has(status)) this._hideStatuses.delete(status);
      });
      if (!this._hideStatuses.size) this._hideStatuses = null;
    }
    this._syncFilterButtonState?.();
  },

  _getStatusColor(statusName) {
    const found = this._getStatusList().find((item) => item.name === statusName);
    return found?.color || '#6fa8dc';
  },

  _renderRowStatusButton(button, row) {
    if (!button || !row) return;
    const status = String(row.status || '').trim();
    button.innerHTML = '';
    button.classList.toggle('is-empty', !status);
    button.dataset.status = status;
    const dot = document.createElement('span');
    dot.className = 'sn2-status-dot';
    if (status) dot.style.background = this._getStatusColor(status);
    const label = document.createElement('span');
    label.className = 'sn2-status-label';
    label.textContent = status || '未設定';
    button.appendChild(dot);
    button.appendChild(label);
    button.title = status ? `採用状況: ${status}` : 'クリックで採用状況を設定';
  },

  _showRowStatusMenu(anchorBtn, row, rowEl = null) {
    if (!anchorBtn || !row || !this.doc?.editor?.statusEnabled) return;
    document.querySelectorAll('.sn2-status-popup').forEach((el) => el.remove());
    const popup = document.createElement('div');
    popup.className = 'sn2-status-popup sn2-header-popup';
    popup.style.cssText = 'position:fixed;z-index:10000;min-width:160px;';
    const items = [
      { label: '未設定', value: '', color: '' },
      ...this._getStatusList().map(item => ({ label: item.name, value: item.name, color: item.color })),
    ];
    let closeHandler = null;
    const closePopup = (restoreFocus = false) => {
      popup.remove();
      if (closeHandler) {
        document.removeEventListener('pointerdown', closeHandler);
        closeHandler = null;
      }
      if (restoreFocus && typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(anchorBtn);
    };
    const applyStatus = (statusValue) => {
      const prevStatus = String(row.status || '');
      const wasVisible = this._isRoleVisible(row.role || '', prevStatus);
      const nextStatus = String(statusValue || '').trim();
      if (prevStatus === nextStatus) return;
      this._pushUndo('採用状況変更');
      if (nextStatus) row.status = nextStatus;
      else delete row.status;
      const isVisible = this._isRoleVisible(row.role || '', row.status || '');
      if (!rowEl || wasVisible !== isVisible) this._render();
      else this._renderRowStatusButton(anchorBtn, row);
      this._markDirty({ skipUndo: true });
    };

    const mkItem = (label, statusValue, color = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn2-header-popup-item';
      btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;';
      if ((row.status || '') === statusValue) btn.classList.add('active');
      const dot = document.createElement('span');
      dot.className = 'sn2-status-dot';
      if (color) dot.style.background = color;
      const text = document.createElement('span');
      text.textContent = label;
      btn.appendChild(dot);
      btn.appendChild(text);
      btn.addEventListener('click', () => {
        closePopup(true);
        applyStatus(statusValue);
      });
      return btn;
    };

    popup.appendChild(mkItem(items[0].label, items[0].value, items[0].color));
    const sep = document.createElement('div');
    sep.className = 'sn2-header-popup-sep';
    popup.appendChild(sep);
    items.slice(1).forEach((item) => {
      popup.appendChild(mkItem(item.label, item.value, item.color));
    });
    document.body.appendChild(popup);
    positionPopup(popup, anchorBtn.getBoundingClientRect());
    if (typeof bindMeldexDropdownKeySwitch === 'function') {
      bindMeldexDropdownKeySwitch(anchorBtn, {
        getItems: () => items.map(item => ({ value: item.value, item })),
        getCurrentValue: () => row.status || '',
        onSelect: item => applyStatus(item.value),
        getFreshTrigger: () => anchorBtn.isConnected ? anchorBtn : null,
      });
    }
    closeHandler = (ev) => {
      if (!popup.contains(ev.target) && ev.target !== anchorBtn) {
        closePopup(false);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 0);
  },

});
