/* gb-scriptnote-menu.js: 台本エディタ v2 — タイプ選択メニュー
   ScriptNoteEditor.prototype を拡張する */

Object.assign(ScriptNoteEditor.prototype, {

  _showRoleMenu(roleBtn) {
    this._closeRoleMenu();
    const rowEl = roleBtn.closest('.sn2-row');
    if (!rowEl) return;
    const rowId = rowEl.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    if (idx < 0) return;
    const currentRole = this.doc.rows[idx].role;

    const menu = document.createElement('div');
    menu.className = 'sn2-role-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'タイプを選択');
    menu.tabIndex = -1;

    const pageSettings = typeof PAGE_SETTINGS !== 'undefined' && Array.isArray(PAGE_SETTINGS)
      ? PAGE_SETTINGS : ['改ページ', 'めくり', '見開き', '白紙', 'トビラ絵', '大ゴマ', '未完'];
    const specialCharas = typeof SPECIAL_CHARA !== 'undefined' && Array.isArray(SPECIAL_CHARA)
      ? SPECIAL_CHARA : ['プロット', 'ト書き', 'ナレーション', '擬音', 'コマ外注釈'];
    const chars = this._getCharacterList();

    const select = (val) => {
      this._pushUndo('タイプ変更');
      this._setRowRole(idx, rowEl, val === '（なし）' ? '' : val);
      this._closeRoleMenu();
      const textEl = rowEl.querySelector('.sn2-text');
      if (textEl) textEl.focus();
    };

    // タイプ管理に登録されているタイプのみ表示。
    // 設定駆動: オプション設定の isBreak/isSummary でグルーピング、それ以外はすべて「タイプ」へ
    const registered = new Set(this.doc.characters.map(c => c.name));
    const groups = { normal: [], summary: [], break: [] };
    this.doc.characters.forEach(c => {
      if (c.isDefault) return;
      if (!c.name) return;
      if (c.isBreak) groups.break.push(c.name);
      else if (c.isSummary) groups.summary.push(c.name);
      else groups.normal.push(c.name);
    });
    // カテゴリ定義
    const categories = [
      { label: 'タイプ', items: groups.normal, directToInput: !groups.normal.length },
      { label: 'プロット', items: groups.summary },
      { label: '区切り', items: groups.break },
      { label: 'なし', items: ['（なし）'] },
    ];
    let allButtons = [];
    let openSub = null;
    const closeSub = () => { if (openSub) { openSub.remove(); openSub = null; } };
    const totalRoles = this.doc.characters.filter(c => !c.isDefault).length;
    const useGrouped = totalRoles > 20;

    if (useGrouped) {
      // 20超: カテゴリ分類で表示
      categories.forEach(cat => {
        if (!cat.items.length && !cat.directToInput) return;
        const catBtn = document.createElement('button');
        catBtn.className = 'sn2-role-cat';
        catBtn.type = 'button';
        catBtn.setAttribute('role', 'menuitem');
        catBtn.textContent = cat.label;
        if (cat.items.length > 1 || cat.directToInput) {
          const arrow = document.createElement('span');
          arrow.className = 'sn2-role-cat-arrow';
          arrow.innerHTML = lucide('chevronRight', 10);
          catBtn.appendChild(arrow);
        }
        if (cat.items.includes(currentRole)) catBtn.classList.add('active');
        catBtn.addEventListener('click', () => {
          if (cat.directToInput) { closeSub(); input.focus(); input.select(); return; }
          if (cat.items.length === 1) { select(cat.items[0]); return; }
          if (openSub) { const prev = openSub; closeSub(); if (prev._catLabel === cat.label) return; }
          const sub = document.createElement('div');
          sub.className = 'sn2-role-sub-popup';
          sub.setAttribute('role', 'menu');
          sub.setAttribute('aria-label', `${cat.label}のタイプ`);
          sub._catLabel = cat.label;
          cat.items.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'sn2-role-item' + (t === currentRole ? ' active' : '');
            btn.type = 'button';
            btn.setAttribute('role', 'menuitem');
            btn.textContent = t;
            const style = this._getCharaStyle(t);
            if (style) btn.style.cssText = style;
            btn.addEventListener('click', () => select(t));
            sub.appendChild(btn);
            allButtons.push(btn);
          });
          const menuRect = menu.getBoundingClientRect();
          const catRect = catBtn.getBoundingClientRect();
          sub.style.cssText = 'position:fixed;z-index:10100;';
          document.body.appendChild(sub);
          positionPopup(sub, { left: menuRect.right, right: menuRect.right + 2, top: catRect.top, bottom: catRect.bottom }, { prefer: 'right' });
          if (typeof requestAnimationFrame === 'function' && typeof clampPopupToViewport === 'function') {
            requestAnimationFrame(() => { if (sub.isConnected) clampPopupToViewport(sub); });
          }
          openSub = sub;
        });
        menu.appendChild(catBtn);
      });
    } else {
      // 20以下: フラットリストで表示
      const flatItems = [];
      this.doc.characters.forEach(c => { if (!c.isDefault) flatItems.push(c.name); });
      flatItems.push('（なし）');
      flatItems.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'sn2-role-item' + (t === currentRole || (t === '（なし）' && !currentRole) ? ' active' : '');
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = t;
        const style = this._getCharaStyle(t);
        if (style) btn.style.cssText = style;
        btn.addEventListener('click', () => select(t));
        menu.appendChild(btn);
        allButtons.push(btn);
      });
    }

    // 自由入力
    const inputWrap = document.createElement('div');
    inputWrap.className = 'sn2-role-group';
    const inputLabel = document.createElement('div');
    inputLabel.className = 'sn2-role-group-label';
    inputLabel.textContent = '自由入力';
    inputWrap.appendChild(inputLabel);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sn2-role-input';
    input.placeholder = 'キャラ名を入力';
    input.setAttribute('aria-label', 'タイプ名を入力');
    input.value = currentRole;
    inputWrap.appendChild(input);
    menu.appendChild(inputWrap);
    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'sn2-role-item sn2-role-link';
    linkBtn.setAttribute('role', 'menuitem');
    linkBtn.textContent = 'リンクを設定...';
    linkBtn.addEventListener('click', () => {
      const textEl = rowEl.querySelector('.sn2-text');
      this._closeRoleMenu();
      if (!textEl || typeof showLinkInsertModal !== 'function') return;
      showLinkInsertModal(null, (result) => {
        if (!textEl.isConnected || typeof this._insertLinkResultIntoText !== 'function') return;
        this._insertLinkResultIntoText(textEl, null, result);
      });
    });
    menu.appendChild(linkBtn);
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(menu, {
        trigger: roleBtn,
        close: () => this._closeRoleMenu(),
      });
    }

    // キーボードナビゲーション
    const catBtns = [...menu.querySelectorAll('.sn2-role-cat')];
    // フラットリスト時はallButtonsで直接ナビゲーション
    const flatBtns = !useGrouped ? [...menu.querySelectorAll('.sn2-role-item')] : [];
    let flatIdx = -1;
    let catIdx = -1; // カテゴリフォーカス
    let subIdx = -1; // サブメニューアイテムフォーカス
    const focusCat = (i) => {
      if (i < 0 || i >= catBtns.length) return;
      catIdx = i; subIdx = -1;
      catBtns[i].focus();
      catBtns[i].classList.add('focused');
      catBtns.forEach((b, j) => { if (j !== i) b.classList.remove('focused'); });
    };
    const focusSubItem = (i) => {
      if (!openSub) return;
      const items = [...openSub.querySelectorAll('.sn2-role-item')];
      if (i < 0 || i >= items.length) return;
      subIdx = i;
      items[i].focus();
      items[i].scrollIntoView({ block: 'nearest' });
    };
    const menuKeyHandler = (e) => {
      if (!this._roleMenu) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (openSub) { closeSub(); if (catIdx >= 0) catBtns[catIdx].focus(); }
        else { this._closeRoleMenu(); roleBtn.closest('.sn2-row')?.querySelector('.sn2-text')?.focus(); }
        return;
      }
      const inMenu = menu.contains(document.activeElement) || document.activeElement?.closest?.('.sn2-role-sub-popup');
      if (!inMenu) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        if (flatBtns.length) {
          // フラットリスト: 直接ボタン間移動
          if (document.activeElement === input) {
            flatIdx = Math.min(flatBtns.length - 1, step - 1);
            flatBtns[flatIdx]?.focus();
          } else if (flatIdx >= flatBtns.length - 1) {
            input.focus(); input.select(); flatIdx = -1;
          } else {
            flatIdx = Math.min(flatBtns.length - 1, flatIdx + step);
            flatBtns[flatIdx]?.focus();
          }
        } else if (openSub) {
          const items = [...openSub.querySelectorAll('.sn2-role-item')];
          focusSubItem(Math.min(items.length - 1, subIdx + step));
        } else if (document.activeElement === input) {
          focusCat(Math.min(catBtns.length - 1, step - 1));
        } else {
          focusCat(Math.min(catBtns.length - 1, catIdx + step));
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        if (flatBtns.length) {
          if (document.activeElement === input) {
            flatIdx = Math.max(0, flatBtns.length - step);
            flatBtns[flatIdx]?.focus();
          } else if (flatIdx <= 0) {
            input.focus(); input.select(); flatIdx = -1;
          } else {
            flatIdx = Math.max(0, flatIdx - step);
            flatBtns[flatIdx]?.focus();
          }
        } else if (openSub) {
          if (subIdx <= 0) { closeSub(); if (catIdx >= 0) catBtns[catIdx].focus(); }
          else focusSubItem(Math.max(0, subIdx - step));
        } else if (catIdx <= 0) {
          input.focus(); input.select(); catIdx = -1;
        } else {
          focusCat(Math.max(0, catIdx - step));
        }
        return;
      }
      if (e.key === 'ArrowRight' && catIdx >= 0 && !openSub) {
        e.preventDefault();
        catBtns[catIdx].click(); // サブメニューを開く
        setTimeout(() => { if (openSub) focusSubItem(0); }, 0);
        return;
      }
      if (e.key === 'ArrowLeft' && openSub) {
        e.preventDefault();
        closeSub(); if (catIdx >= 0) catBtns[catIdx].focus();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (document.activeElement === input) { select(input.value.trim()); return; }
        if (flatBtns.length && flatIdx >= 0 && flatBtns[flatIdx]) { flatBtns[flatIdx].click(); return; }
        if (openSub && subIdx >= 0) {
          const items = [...openSub.querySelectorAll('.sn2-role-item')];
          if (items[subIdx]) { items[subIdx].click(); return; }
        }
        if (catIdx >= 0) {
          catBtns[catIdx].click();
          setTimeout(() => { if (openSub) focusSubItem(0); }, 0);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement !== input) { e.preventDefault(); select('（なし）'); return; }
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (flatBtns.length) {
          if (document.activeElement === input) { flatIdx = 0; flatBtns[0]?.focus(); }
          else { input.focus(); input.select(); flatIdx = -1; }
        } else {
          if (document.activeElement === input) focusCat(0);
          else { input.focus(); input.select(); catIdx = -1; closeSub(); }
        }
        return;
      }
      // 文字入力→入力欄にフォーカス移動
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && document.activeElement !== input) {
        input.focus(); catIdx = -1; closeSub();
      }
    };
    document.addEventListener('keydown', menuKeyHandler);
    // _closeRoleMenuで解除するため保持
    this._roleMenuKeyHandler = menuKeyHandler;

    // 位置決め
    const rect = roleBtn.getBoundingClientRect();
    menu.style.cssText = 'position:fixed;z-index:10100;';
    document.body.appendChild(menu);
    positionPopup(menu, rect);
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);

    this._roleMenu = menu;
    this._roleMenuRow = rowId;
    this._roleMenuCloseHandler = null;
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== roleBtn && !ev.target.closest?.('.sn2-role-sub-popup')) this._closeRoleMenu();
      };
      this._roleMenuCloseHandler = close;
      document.addEventListener('pointerdown', close, true);
    }, 0);
    input.focus();
    input.select();
  },

  _closeRoleMenu() {
    if (this._roleMenuCloseHandler) {
      document.removeEventListener('pointerdown', this._roleMenuCloseHandler, true);
      this._roleMenuCloseHandler = null;
    }
    if (this._roleMenuKeyHandler) {
      document.removeEventListener('keydown', this._roleMenuKeyHandler);
      this._roleMenuKeyHandler = null;
    }
    document.querySelectorAll('.sn2-role-sub-popup').forEach(el => el.remove());
    if (this._roleMenu) {
      this._roleMenu.remove();
      this._roleMenu = null;
      this._roleMenuRow = null;
    }
  },

  _isEditingAutoLinkTarget(autoLinkEl) {
    const activeText = document.activeElement?.closest?.('.sn2-text');
    if (!activeText || !this.host?.contains(activeText)) return false;
    const linkText = autoLinkEl?.closest?.('.sn2-text');
    return !!(linkText && linkText === activeText);
  },

  _upsertAutoLinkEntry(text, path) {
    const label = String(text || '').trim();
    const target = String(path || '').trim();
    if (!label || !target) return;
    if (typeof linkDict !== 'undefined' && Array.isArray(linkDict)) {
      if (!linkDict.some(d => d.text === label && d.path === target)) {
        linkDict.push({ text: label, path: target });
      }
    }
  },

  _formatManualLinkMarkup(label, target) {
    return _sn2BuildManualLinkMarkup(label, target);
  },

  _decodeManualLinkLabel(label) {
    return _sn2DecodeManualLinkLabel(label);
  },

  _createManualLinkSpan(label, target) {
    const span = document.createElement('span');
    span.className = 'auto-link';
    span.dataset.path = target || '';
    span.dataset.manualLink = 'true';
    span.textContent = label || target || '';
    return span;
  },

  _appendScriptNoteInlineFragment(frag, rawText) {
    if (!frag || !rawText) return;
    if (rawText.includes('{') && rawText.includes('|') && typeof _sn2NewRubyRegex === 'function') {
      let last = 0;
      const re = _sn2NewRubyRegex();
      let m;
      while ((m = re.exec(rawText)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(_sn2UnescapeScriptNotePlainText(rawText.slice(last, m.index))));
        const span = document.createElement('span');
        span.dataset.ruby = _sn2UnescapeRubyText(m[2]);
        span.textContent = _sn2UnescapeRubyText(m[1]);
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < rawText.length) frag.appendChild(document.createTextNode(_sn2UnescapeScriptNotePlainText(rawText.slice(last))));
      return;
    }
    frag.appendChild(document.createTextNode(_sn2UnescapeScriptNotePlainText(rawText)));
  },

  _buildManualLinkFragment(rawText) {
    const frag = document.createDocumentFragment();
    const re = /\[((?:\\.|[^\]])+)\]\(ml:([^)]+)\)/g;
    let last = 0;
    let matched = false;
    let m;
    while ((m = re.exec(rawText || '')) !== null) {
      matched = true;
      if (m.index > last) this._appendScriptNoteInlineFragment(frag, rawText.slice(last, m.index));
      let target = '';
      try { target = decodeURIComponent(m[2]); } catch { target = m[2]; }
      frag.appendChild(this._createManualLinkSpan(this._decodeManualLinkLabel(m[1]), target));
      last = m.index + m[0].length;
    }
    if (!matched) return null;
    if (last < rawText.length) this._appendScriptNoteInlineFragment(frag, rawText.slice(last));
    return frag;
  },

  _restoreTextSelectionForLinkInsert(textEl, savedRange) {
    if (!textEl) return null;
    textEl.focus();
    const sel = window.getSelection();
    if (!sel) return null;
    if (savedRange) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRange);
        return sel;
      } catch {}
    }
    const inText = sel.rangeCount > 0
      && textEl.contains(sel.anchorNode)
      && textEl.contains(sel.focusNode);
    if (!inText) {
      const range = document.createRange();
      range.selectNodeContents(textEl);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return sel;
  },

  _insertLinkResultIntoText(textEl, savedRange, result) {
    if (!textEl || !result) return false;
    const sel = this._restoreTextSelectionForLinkInsert(textEl, savedRange);
    if (!sel) return false;
    const selectedLabel = (sel.toString() || '').trim();
    let label = '';
    let target = '';
    if (result.type === 'file') {
      label = selectedLabel || result.name || result.path || '';
      target = result.path || '';
    } else if (result.type === 'url') {
      label = selectedLabel || result.url || '';
      target = result.url || '';
    } else {
      return false;
    }
    if (!label || !target || !sel.rangeCount) return false;
    this._pushUndo('リンク挿入');
    const span = this._createManualLinkSpan(label, target);
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(span);
    range.setStartAfter(span);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    this._upsertAutoLinkEntry(label, target);
    this._syncRowFromDom(textEl, { skipUndo: true });
    return true;
  },

  _setRowRole(idx, rowEl, newRole) {
    this.doc.rows[idx].role = newRole;
    // dataset.kind: オプション設定 isBreak/isSummary/kind を反映
    const charaForKind = newRole
      ? this.doc.characters.find(c => !c.isDefault && c.name === newRole)
      : null;
    let kind = 'dialogue';
    if (!newRole) kind = 'blank';
    else if (charaForKind?.isSummary) kind = 'summary';
    else if (charaForKind?.isBreak) kind = 'break';
    else if (['dialogue', 'action', 'heading'].includes(charaForKind?.kind)) kind = charaForKind.kind;
    rowEl.dataset.kind = kind;
    // 枠線設定（タイプ個別のoutline）— 役割空時はデフォルトタイプから引く
    const outlineChara = newRole
      ? this.doc.characters.find(c => !c.isDefault && c.name === newRole)
      : this.doc.characters.find(c => c.isDefault);
    if (outlineChara?.outline) {
      rowEl.dataset.outline = 'true';
      if (outlineChara.outlineColor) rowEl.style.setProperty('--sn2-outline-color', outlineChara.outlineColor);
      if (outlineChara.outlineWidth) rowEl.style.setProperty('--sn2-outline-width', outlineChara.outlineWidth + 'px');
    } else {
      delete rowEl.dataset.outline;
      rowEl.style.removeProperty('--sn2-outline-color');
      rowEl.style.removeProperty('--sn2-outline-width');
    }
    const btn = rowEl.querySelector('.sn2-role-btn');
    if (btn) {
      btn.textContent = newRole || '';
      // 縦書き: 半角英数字を縦中横に再ラップ
      if (this.doc.editor?.viewMode === 'vertical') this._wrapTcy(btn);
    }
    // キャラクターリストに追加（タイプ管理に反映 + 自動配色）
    if (newRole && !this.doc.characters.some(c => !c.isDefault && c.name === newRole)) {
      const newChara = { name: newRole };
      this._assignAutoColor(newChara);
      // デフォルトタイプの直前に挿入（末尾固定の不変条件を維持）
      const defIdx = this.doc.characters.findIndex(c => c.isDefault);
      if (defIdx >= 0) this.doc.characters.splice(defIdx, 0, newChara);
      else this.doc.characters.push(newChara);
    }
    // スタイル適用
    this._applyRowStyle(rowEl, newRole);
    // ページ/コマ番号更新
    this._calcCache = null;
    this._updateGuttersFrom(Math.max(0, idx));
    this._markDirty({ skipUndo: true }); // undoは呼び出し元で管理
  },

  _syncCharactersFromRows() {
    if (!this.doc) return;
    const registered = new Set(this.doc.characters.map(c => c.name));
    this.doc.rows.forEach(r => {
      if (r.role && !registered.has(r.role)) {
        const newChara = { name: r.role };
        this._assignAutoColor(newChara);
        this.doc.characters.push(newChara);
        registered.add(r.role);
      }
    });
  },

  // 役割が空の行に適用するデフォルトタイプ（isDefault: true）を末尾に常時 1 件保持する。
  // 複数あれば 1 件に統合し、末尾以外にあれば末尾へ移動する。
  _ensureDefaultChara() {
    if (!this.doc) return;
    if (!Array.isArray(this.doc.characters)) this.doc.characters = [];
    const chars = this.doc.characters;
    let def = null;
    for (let i = chars.length - 1; i >= 0; i--) {
      if (chars[i] && chars[i].isDefault) {
        if (def) chars.splice(i, 1); // 重複は削除
        else def = chars[i];
      }
    }
    if (!def) {
      def = { isDefault: true, name: '' };
      chars.push(def);
    } else {
      // name は空文字に正規化（kind は使わない: 識別は isDefault フラグのみ）
      delete def.kind;
      def.name = '';
      // 末尾に移動
      const idx = chars.indexOf(def);
      if (idx !== chars.length - 1) {
        chars.splice(idx, 1);
        chars.push(def);
      }
    }
  },

  // 自動配色: PALETTE_COLORSを循環して割り当て
  _assignAutoColor(chara) {
    if (chara.isDefault) return; // デフォルトタイプは自動配色対象外
    if (chara.autoColor || chara.bgColor) return; // 既に色が設定されている場合はスキップ
    const colors = typeof this._getAutoColorPalette === 'function'
      ? this._getAutoColorPalette()
      : (typeof PALETTE_COLORS !== 'undefined' ? PALETTE_COLORS : []);
    if (!colors.length) return;
    // editor.autoColorRule から列ごとの配色先を取得
    const acRule = this.doc.editor?.autoColorRule || {};
    const allNone = Object.values(acRule).every(v => !v || v === 'none');
    if (allNone) return;
    // 既存キャラの使用色数をカウントしてインデックスを決定
    const existingCount = this.doc.characters.filter(c => c.autoColor || c.bgColor).length;
    const idx = existingCount % colors.length;
    chara.autoColor = colors[idx];
    chara.autoColorTarget = { ...acRule };
  },

  _getCharacterList() {
    const set = new Set();
    this.doc.characters.forEach(c => { if (!c.isDefault && c.name) set.add(c.name); });
    return Array.from(set).sort();
  },

});
