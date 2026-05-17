/* gb-scriptnote-search.js: シナリオ本文の検索置換 */

Object.assign(ScriptNoteEditor.prototype, {

  _closeSearchReplacePopup() {
    if (this._searchPopup?.isConnected) this._searchPopup.remove();
    if (this._searchPopupCloseHandler) {
      document.removeEventListener('pointerdown', this._searchPopupCloseHandler);
      this._searchPopupCloseHandler = null;
    }
    this._updateSearchPopupUi = null;
    this._searchPopup = null;
  },

  _collectSearchMatches(query) {
    const needle = String(query || '');
    if (!needle) return [];
    const matches = [];
    (Array.isArray(this.doc?.rows) ? this.doc.rows : []).forEach((row, rowIndex) => {
      if (!this._isRoleVisible(row.role || '', row.status || '')) return;
      const plain = _sn2StripRubyToPlain(row.text || '');
      let start = 0;
      while (start <= plain.length) {
        const hit = plain.indexOf(needle, start);
        if (hit < 0) break;
        matches.push({ rowId: row.id, rowIndex, start: hit, end: hit + needle.length });
        start = hit + Math.max(needle.length, 1);
      }
    });
    return matches;
  },

  _syncSearchSourceFromDom() {
    if (typeof this._syncAllFromDom === 'function') this._syncAllFromDom();
  },

  _findVisibleTextBoundary(textEl, targetOffset) {
    let remaining = Math.max(0, Number(targetOffset) || 0);
    let found = null;
    const setElementBoundary = (node, after = false) => {
      const parent = node.parentNode || textEl;
      const index = Array.prototype.indexOf.call(parent.childNodes, node);
      found = { container: parent, offset: Math.max(0, index + (after ? 1 : 0)) };
    };
    const walk = (node) => {
      if (found) return;
      if (node.nodeType === 3) {
        const len = node.textContent.length;
        if (remaining <= len) {
          found = { container: node, offset: remaining };
          return;
        }
        remaining -= len;
        return;
      }
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') {
          if (remaining === 0) { setElementBoundary(node, false); return; }
          if (remaining === 1) { setElementBoundary(node, true); return; }
          remaining -= 1;
          return;
        }
        node.childNodes.forEach(walk);
      }
    };
    textEl.childNodes.forEach(walk);
    return found || { container: textEl, offset: textEl.childNodes.length };
  },

  _selectVisibleTextRange(textEl, startOffset, endOffset) {
    if (!textEl) return;
    textEl.focus();
    const start = this._findVisibleTextBoundary(textEl, startOffset);
    const end = this._findVisibleTextBoundary(textEl, endOffset);
    const range = document.createRange();
    range.setStart(start.container, start.offset);
    range.setEnd(end.container, end.offset);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  },

  _findSearchMatchIndex(matches, preferred = null) {
    if (!matches.length) return -1;
    if (!preferred) return 0;
    const prefRow = preferred.rowIndex ?? -1;
    const prefStart = preferred.start ?? -1;
    const idx = matches.findIndex((item) => item.rowIndex > prefRow || (item.rowIndex === prefRow && item.start >= prefStart));
    return idx >= 0 ? idx : 0;
  },

  _activateSearchMatch(match) {
    if (!match) return;
    const rowEl = this.host?.querySelector(`.sn2-row[data-row-id="${match.rowId}"]`);
    const textEl = rowEl?.querySelector('.sn2-text');
    if (!textEl) return;
    textEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    this._selectVisibleTextRange(textEl, match.start, match.end);
  },

  _refreshSearchState(preferred = null) {
    if (!this._searchState) this._searchState = { query: '', replace: '', matches: [], index: -1 };
    this._syncSearchSourceFromDom();
    this._searchState.matches = this._collectSearchMatches(this._searchState.query);
    this._searchState.index = this._findSearchMatchIndex(this._searchState.matches, preferred);
    return this._searchState;
  },

  _jumpSearchMatch(step) {
    const previous = this._searchState?.matches?.[this._searchState.index] || null;
    const state = this._refreshSearchState(previous);
    if (!state.matches.length) return;
    const len = state.matches.length;
    state.index = ((state.index >= 0 ? state.index : 0) + step + len) % len;
    this._activateSearchMatch(state.matches[state.index]);
    this._updateSearchPopupUi?.();
  },

  _replaceSearchMatch(match, replacement) {
    const row = this.doc?.rows?.find((item) => item.id === match?.rowId);
    if (!row) return false;
    row.text = _sn2ReplaceRawTextByVisibleRange(row.text || '', match.start, match.end, replacement);
    return true;
  },

  _replaceCurrentSearchMatch() {
    const previous = this._searchState?.matches?.[this._searchState.index] || null;
    const state = this._refreshSearchState(previous);
    const match = state.matches?.[state.index];
    if (!match) return;
    this._pushUndo('検索置換');
    if (!this._replaceSearchMatch(match, state.replace || '')) return;
    this._render();
    this._markDirty({ skipUndo: true });
    this._refreshSearchState({ rowIndex: match.rowIndex, start: match.start + (state.replace || '').length });
    this._updateSearchPopupUi?.();
    if (this._searchState.matches.length) this._activateSearchMatch(this._searchState.matches[this._searchState.index]);
  },

  _replaceAllSearchMatches() {
    const state = this._refreshSearchState();
    if (!state.query || !state.matches.length) return;
    this._pushUndo('検索一括置換');
    let replaced = 0;
    (Array.isArray(this.doc?.rows) ? this.doc.rows : []).forEach((row) => {
      if (!this._isRoleVisible(row.role || '', row.status || '')) return;
      let plain = _sn2StripRubyToPlain(row.text || '');
      let pos = plain.indexOf(state.query);
      let seekFrom = 0;
      while (pos >= 0) {
        row.text = _sn2ReplaceRawTextByVisibleRange(row.text || '', pos, pos + state.query.length, state.replace || '');
        replaced += 1;
        plain = _sn2StripRubyToPlain(row.text || '');
        seekFrom = pos + (state.replace || '').length;
        pos = plain.indexOf(state.query, seekFrom);
      }
    });
    this._render();
    this._markDirty({ skipUndo: true });
    this._refreshSearchState();
    this._updateSearchPopupUi?.();
    if (typeof showStatus === 'function') showStatus(`${replaced} 件を置換しました`);
  },

  _showSearchReplacePopup(anchorBtn = null) {
    if (!this.doc) return;
    this._closeSearchReplacePopup();
    if (!this._searchState) this._searchState = { query: '', replace: '', matches: [], index: -1 };
    const popup = document.createElement('div');
    popup.className = 'sn2-search-popup sn2-header-popup';
    popup.style.cssText = 'position:fixed;z-index:10000;min-width:320px;max-width:min(420px, calc(100vw - 24px));padding:10px;';
    popup.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;">
        <input type="text" class="sn2-search-input" placeholder="検索">
        <button type="button" class="sn2-header-popup-item" data-sn-search-prev>↑</button>
        <button type="button" class="sn2-header-popup-item" data-sn-search-next>↓</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;margin-top:6px;">
        <input type="text" class="sn2-replace-input" placeholder="置換">
        <button type="button" class="sn2-header-popup-item" data-sn-search-replace>置換</button>
        <button type="button" class="sn2-header-popup-item" data-sn-search-replace-all>全置換</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;">
        <span class="sn2-search-count" style="font-size:11px;color:var(--fg2);">0 / 0</span>
        <button type="button" class="sn2-header-popup-item" data-sn-search-close>閉じる</button>
      </div>`;
    const queryInput = popup.querySelector('.sn2-search-input');
    const replaceInput = popup.querySelector('.sn2-replace-input');
    const countEl = popup.querySelector('.sn2-search-count');
    const btnPrev = popup.querySelector('[data-sn-search-prev]');
    const btnNext = popup.querySelector('[data-sn-search-next]');
    const btnReplace = popup.querySelector('[data-sn-search-replace]');
    const btnReplaceAll = popup.querySelector('[data-sn-search-replace-all]');

    queryInput.value = this._searchState.query || '';
    replaceInput.value = this._searchState.replace || '';

    this._updateSearchPopupUi = () => {
      const state = this._searchState || { matches: [], index: -1 };
      const total = state.matches?.length || 0;
      const current = total ? state.index + 1 : 0;
      countEl.textContent = `${current} / ${total}`;
      const disabled = !total;
      btnPrev.disabled = disabled;
      btnNext.disabled = disabled;
      btnReplace.disabled = disabled;
      btnReplaceAll.disabled = disabled;
    };

    const syncState = (preferred = null, focusCurrent = true) => {
      this._searchState.query = queryInput.value;
      this._searchState.replace = replaceInput.value;
      this._refreshSearchState(preferred);
      this._updateSearchPopupUi();
      if (focusCurrent && this._searchState.matches.length) {
        this._activateSearchMatch(this._searchState.matches[this._searchState.index]);
      }
    };

    queryInput.addEventListener('input', () => syncState(null, false));
    replaceInput.addEventListener('input', () => {
      this._searchState.replace = replaceInput.value;
    });
    queryInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (!this._searchState.matches?.length) syncState();
        else this._jumpSearchMatch(ev.shiftKey ? -1 : 1);
      }
      if (ev.key === 'Escape') this._closeSearchReplacePopup();
    });
    replaceInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this._replaceCurrentSearchMatch();
      }
      if (ev.key === 'Escape') this._closeSearchReplacePopup();
    });
    btnPrev.addEventListener('click', () => this._jumpSearchMatch(-1));
    btnNext.addEventListener('click', () => this._jumpSearchMatch(1));
    btnReplace.addEventListener('click', () => this._replaceCurrentSearchMatch());
    btnReplaceAll.addEventListener('click', () => this._replaceAllSearchMatches());
    popup.querySelector('[data-sn-search-close]').addEventListener('click', () => this._closeSearchReplacePopup());

    document.body.appendChild(popup);
    this._searchPopup = popup;
    if (anchorBtn) positionPopup(popup, anchorBtn.getBoundingClientRect());
    else {
      const hostRect = this.host?.getBoundingClientRect?.();
      const anchorRect = hostRect || { left: 16, right: 16, top: 16, bottom: 16 };
      positionPopup(popup, anchorRect);
    }
    this._searchPopupCloseHandler = (ev) => {
      if (!popup.contains(ev.target) && ev.target !== anchorBtn) this._closeSearchReplacePopup();
    };
    setTimeout(() => document.addEventListener('pointerdown', this._searchPopupCloseHandler), 0);
    syncState(null, !!queryInput.value);
    queryInput.focus();
    queryInput.select();
  },

});
