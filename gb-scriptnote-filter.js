/* gb-scriptnote-filter.js: シナリオのタイプ/採用状況フィルタ UI */

Object.assign(ScriptNoteEditor.prototype, {

  _isRoleVisible(roleOrRow, statusValue = '') {
    const row = roleOrRow && typeof roleOrRow === 'object' ? roleOrRow : null;
    const role = row ? String(row.role || '') : String(roleOrRow || '');
    const status = row ? String(row.status || '') : String(statusValue || '');
    if (this._hideRoles && this._hideRoles.has(role)) return false;
    if (this._filterRoles && !this._filterRoles.has(role)) return false;
    if (this.doc?.editor?.statusEnabled) {
      if (this._hideStatuses && this._hideStatuses.has(status)) return false;
      if (this._filterStatuses && !this._filterStatuses.has(status)) return false;
    }
    return true;
  },

  _showFilterMenu(anchorBtn) {
    document.querySelectorAll('.sn2-filter-popup').forEach((el) => el.remove());
    const roles = new Set();
    this.doc.rows.forEach((row) => { if (row.role) roles.add(row.role); });
    const statusEnabled = !!this.doc.editor?.statusEnabled;
    const statusItems = statusEnabled
      ? [{ label: '（未設定）', key: '', color: '' }, ...this._getStatusList().map((item) => ({ label: item.name, key: item.name, color: item.color }))]
      : [];

    const popup = document.createElement('div');
    popup.className = 'sn2-filter-popup sn2-header-popup';

    const hasAnyFilter = () => !!this._filterRoles
      || !!(this._hideRoles && this._hideRoles.size)
      || !!this._filterStatuses
      || !!(this._hideStatuses && this._hideStatuses.size);

    const updateFilterActive = () => {
      anchorBtn.classList.toggle('active', hasAnyFilter());
    };

    const setPresetSelection = (value) => {
      const filterPreset = this.host?.closest?.('.gb-scriptnote-root')?.querySelector('#sn-filter-preset') || document.getElementById('sn-filter-preset');
      if (filterPreset) {
        if (value === '__custom__' && !filterPreset.querySelector('option[value="__custom__"]')) {
          const opt = document.createElement('option');
          opt.value = '__custom__';
          opt.textContent = 'カスタム';
          filterPreset.insertBefore(opt, filterPreset.options[1] || null);
        }
        filterPreset.value = value;
      }
      const comp = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent() : null;
      if (comp?._editor === this) comp._activeFilterPreset = value;
      this._activeFilterPreset = value;
    };

    const markCustomFilter = () => setPresetSelection('__custom__');

    let closeHandler;
    const close = () => {
      popup.remove();
      if (closeHandler) document.removeEventListener('pointerdown', closeHandler);
    };
    closeHandler = (ev) => {
      if (!popup.contains(ev.target) && ev.target !== anchorBtn) close();
    };

    const allLbl = document.createElement('label');
    allLbl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:12px;cursor:pointer;';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.checked = !hasAnyFilter();
    allCb.addEventListener('change', () => {
      this._filterRoles = null;
      this._hideRoles = null;
      this._filterStatuses = null;
      this._hideStatuses = null;
      this._render();
      updateFilterActive();
      setPresetSelection('__all__');
      allCb.checked = !hasAnyFilter();
    });
    allLbl.appendChild(allCb);
    allLbl.appendChild(document.createTextNode('すべて表示'));
    popup.appendChild(allLbl);

    const sep = document.createElement('div');
    sep.className = 'sn2-header-popup-sep';
    popup.appendChild(sep);

    const appendSection = (title, items, visibleProp, hiddenProp) => {
      if (!items.length) return;
      const titleEl = document.createElement('div');
      titleEl.className = 'sn2-header-popup-label';
      titleEl.textContent = title;
      popup.appendChild(titleEl);

      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display:grid;grid-template-columns:36px 36px 1fr;gap:0;padding:2px 8px 4px;font-size:10px;color:var(--fg2);font-weight:600;text-align:center;';
      const showHead = document.createElement('div');
      showHead.textContent = '表示';
      const hideHead = document.createElement('div');
      hideHead.textContent = '非表示';
      const typeHead = document.createElement('div');
      typeHead.style.textAlign = 'left';
      typeHead.style.paddingLeft = '4px';
      typeHead.textContent = title;
      headerRow.appendChild(showHead);
      headerRow.appendChild(hideHead);
      headerRow.appendChild(typeHead);
      popup.appendChild(headerRow);

      const visibleSet = this[visibleProp] || new Set(items.map((item) => item.key));
      items.forEach((item) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:36px 36px 1fr;gap:0;align-items:center;padding:3px 8px;font-size:12px;cursor:default;';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg4)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        const showCb = document.createElement('input');
        showCb.type = 'checkbox';
        showCb.style.cssText = 'justify-self:center;margin:0;cursor:pointer;';
        showCb.checked = visibleSet.has(item.key);
        showCb.addEventListener('click', (ev) => {
          if (ev.altKey) {
            ev.preventDefault();
            this[visibleProp] = new Set([item.key]);
            this[hiddenProp] = null;
            popup.querySelectorAll(`input[data-filter-prop="${visibleProp}"]`).forEach((other) => {
              other.checked = other.dataset.filterKey === item.key;
            });
            popup.querySelectorAll(`input[data-filter-hidden-prop="${hiddenProp}"]`).forEach((other) => {
              other.checked = false;
            });
            allCb.checked = false;
            markCustomFilter();
            this._render();
            updateFilterActive();
          }
        });
        showCb.dataset.filterProp = visibleProp;
        showCb.dataset.filterKey = item.key;
        showCb.addEventListener('change', (ev) => {
          if (!this[visibleProp]) this[visibleProp] = new Set(items.map((entry) => entry.key));
          if (ev.target.checked) {
            this[visibleProp].add(item.key);
            if (this[hiddenProp]) {
              this[hiddenProp].delete(item.key);
              if (!this[hiddenProp].size) this[hiddenProp] = null;
            }
            hideCb.checked = false;
          } else {
            this[visibleProp].delete(item.key);
          }
          this._render();
          updateFilterActive();
          allCb.checked = false;
          markCustomFilter();
        });

        const hideCb = document.createElement('input');
        hideCb.type = 'checkbox';
        hideCb.style.cssText = 'justify-self:center;margin:0;cursor:pointer;';
        hideCb.checked = !!(this[hiddenProp] && this[hiddenProp].has(item.key));
        hideCb.title = 'チェックすると常に非表示';
        hideCb.dataset.filterHiddenProp = hiddenProp;
        hideCb.dataset.filterKey = item.key;
        hideCb.addEventListener('change', (ev) => {
          if (!this[hiddenProp]) this[hiddenProp] = new Set();
          if (ev.target.checked) {
            this[hiddenProp].add(item.key);
            if (this[visibleProp]) this[visibleProp].delete(item.key);
            showCb.checked = false;
          } else {
            this[hiddenProp].delete(item.key);
          }
          if (!this[hiddenProp].size) this[hiddenProp] = null;
          this._render();
          updateFilterActive();
          allCb.checked = false;
          markCustomFilter();
        });

        const labelEl = document.createElement('span');
        labelEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        if (item.color) {
          const dot = document.createElement('span');
          dot.className = 'sn2-status-dot';
          dot.style.background = item.color;
          labelEl.appendChild(dot);
        }
        const text = document.createElement('span');
        text.textContent = item.label;
        labelEl.appendChild(text);

        row.appendChild(showCb);
        row.appendChild(hideCb);
        row.appendChild(labelEl);
        popup.appendChild(row);
      });
    };

    const charaOrder = (this.doc.characters || []).map((chara) => chara.name);
    const sortedRoles = Array.from(roles).sort((a, b) => {
      const ai = charaOrder.indexOf(a);
      const bi = charaOrder.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    }).map((role) => ({ label: role, key: role, color: '' }));

    appendSection('タイプ', [...sortedRoles, { label: '（タイプなし）', key: '', color: '' }], '_filterRoles', '_hideRoles');
    if (statusEnabled) {
      const sep2 = document.createElement('div');
      sep2.className = 'sn2-header-popup-sep';
      popup.appendChild(sep2);
      appendSection('採用状況', statusItems, '_filterStatuses', '_hideStatuses');
    }
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(popup, {
        trigger: anchorBtn,
        close,
      });
    }

    popup.style.cssText = 'position:fixed;z-index:10000;min-width:240px;max-height:420px;overflow-y:auto;';
    positionPopup(popup, anchorBtn.getBoundingClientRect());
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 0);
  },

});
