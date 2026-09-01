/* gb-scriptnote-menu.js: 台本エディタ v2 — タイプ選択メニュー
   ScriptNoteEditor.prototype を拡張する */

Object.assign(ScriptNoteEditor.prototype, {

  _showRoleMenu(roleBtn, opts) {
    this._closeRoleMenu();
    // タイプメニューの操作中は、直前の文字選択から遅延表示される
    // 書式ポップアップが Escape を先取りしないよう抑止する。
    window.GBTextSelectionFormat?.suppressFor?.(1200);
    const sel = window.getSelection();
    this._roleMenuSavedRange = null;
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      const textEl = r.startContainer?.nodeType === 3
        ? r.startContainer.parentElement?.closest?.('.sn2-text')
        : r.startContainer?.closest?.('.sn2-text');
      if (textEl && this.host?.contains(textEl)) {
        this._roleMenuSavedRange = r.cloneRange();
      }
    }
    const rowEl = roleBtn.closest('.sn2-row');
    if (!rowEl) return;
    const rowId = rowEl.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    if (idx < 0) return;
    const currentRow = this.doc.rows[idx];
    const currentRole = currentRow.role;
    const currentResolved = globalThis.GBScriptNoteRoleModel?.resolveRole?.(this.doc, currentRow);

    const menu = document.createElement('div');
    menu.className = 'sn2-role-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'タイプを選択');
    menu.tabIndex = -1;

    const pageSettings = typeof PAGE_SETTINGS !== 'undefined' && Array.isArray(PAGE_SETTINGS)
      ? PAGE_SETTINGS : ['改ページ', 'めくり', '見開き', '白紙', 'トビラ絵', '大ゴマ', '未完'];
    const specialCharas = typeof SPECIAL_CHARA !== 'undefined' && Array.isArray(SPECIAL_CHARA)
      ? SPECIAL_CHARA : ['プロット', 'ト書き', 'ナレーション', '擬音', 'コマ外アノテート'];
    const chars = this._getCharacterList();

    const select = (val) => {
      this._pushUndo('タイプ変更');
      this._setRowRole(idx, rowEl, val === '（なし）' ? '' : val);
      this._closeRoleMenu();
      if (opts?.fromNav) {
        const btn = rowEl.querySelector('.sn2-role-btn');
        if (btn && typeof this._setActiveCell === 'function') {
          this._setActiveCell(rowId, '_role', false);
        } else {
          this._restoreRangeAfterRoleMenu(rowEl);
        }
      } else {
        this._restoreRangeAfterRoleMenu(rowEl);
      }
    };

    const roleChoices = globalThis.GBScriptNoteRoleModel?.buildRoleChoices?.(this.doc)
      || this.doc.characters.filter((item) => !item.isDefault && item.name).map((item) => ({
        kind: 'character',
        id: item.id || item.name,
        name: item.name,
        label: item.name,
        ref: item.name,
      }));
    if (currentResolved?.kind === 'type'
      && !roleChoices.some((choice) => choice?.kind === 'type' && choice.id === currentResolved.id)) {
      const noneIndex = roleChoices.findIndex((choice) => choice?.kind === 'none');
      const retainedChoice = {
        kind: 'type',
        id: currentResolved.id,
        name: currentResolved.name,
        label: currentResolved.name,
        ref: { ...currentResolved.ref },
      };
      if (noneIndex >= 0) roleChoices.splice(noneIndex, 0, retainedChoice);
      else roleChoices.push(retainedChoice);
    }
    roleChoices.filter((choice) => choice?.kind !== 'none').forEach((choice) => {
      const choiceName = String(choice.name || choice.label || '');
      if (!choiceName) return;
      const btn = document.createElement('button');
      const isCurrent = currentResolved
        ? currentResolved.kind === choice.kind && currentResolved.id === choice.id
        : choiceName === currentRole;
      btn.className = 'sn2-role-item' + (isCurrent ? ' active' : '');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = choice.label || choiceName;
      const style = this._getCharaStyle(choiceName);
      if (style) btn.style.cssText = style;
      btn.addEventListener('click', () => select(choice.ref || choiceName));
      menu.appendChild(btn);
    });

    // 空欄タイプは管理画面の「（なし）」と同じ名称で、件数に関係なく常に選べる。
    // 既存のArrowDown順（最初の通常タイプ）を変えないよう、通常候補の末尾へ置く。
    const noneButton = document.createElement('button');
    noneButton.className = 'sn2-role-item' + (!currentRole ? ' active' : '');
    noneButton.type = 'button';
    noneButton.setAttribute('role', 'menuitem');
    noneButton.textContent = '（なし）';
    noneButton.addEventListener('click', () => select(''));
    menu.appendChild(noneButton);

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
    input.title = '';
    input.value = currentRole;
    inputWrap.appendChild(input);
    menu.appendChild(inputWrap);

    // 行本文へ手動リンクを設定する（タイプ選択とは独立したアクション）
    const linkButton = document.createElement('button');
    linkButton.className = 'sn2-role-link';
    linkButton.type = 'button';
    linkButton.setAttribute('role', 'menuitem');
    linkButton.textContent = 'リンクを設定';
    linkButton.addEventListener('click', () => {
      this._closeRoleMenu();
      this._insertLinkFromRoleMenu(rowEl);
    });
    menu.appendChild(linkButton);

    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(menu, {
        trigger: roleBtn,
        close: () => this._closeRoleMenu(),
      });
    }

    // キーボードナビゲーション（フラットリスト + 自由入力）
    const flatBtns = [...menu.querySelectorAll('.sn2-role-item')];
    let flatIdx = -1;
    const focusFlat = (i) => {
      if (i < 0 || i >= flatBtns.length) return;
      flatIdx = i;
      flatBtns[i].focus();
      flatBtns[i].scrollIntoView({ block: 'nearest' });
    };
    const menuKeyHandler = (e) => {
      if (!this._roleMenu) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this._closeRoleMenu();
        this._restoreRangeAfterRoleMenu(roleBtn.closest('.sn2-row'));
        return;
      }
      const inMenu = menu.contains(document.activeElement);
      if (!inMenu) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        if (document.activeElement === input) {
          focusFlat(Math.min(flatBtns.length - 1, step - 1));
        } else if (flatIdx >= flatBtns.length - 1) {
          input.focus(); input.select(); flatIdx = -1;
        } else {
          focusFlat(Math.min(flatBtns.length - 1, flatIdx + step));
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        if (document.activeElement === input) {
          focusFlat(Math.max(0, flatBtns.length - step));
        } else if (flatIdx <= 0) {
          input.focus(); input.select(); flatIdx = -1;
        } else {
          focusFlat(Math.max(0, flatIdx - step));
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (document.activeElement === input) { select(input.value.trim()); return; }
        if (flatIdx >= 0 && flatBtns[flatIdx]) { flatBtns[flatIdx].click(); }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement !== input) { e.preventDefault(); select('（なし）'); return; }
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (document.activeElement === input) { focusFlat(0); }
        else { input.focus(); input.select(); flatIdx = -1; }
        return;
      }
      // 文字入力→入力欄にフォーカス移動
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && document.activeElement !== input) {
        input.focus();
      }
    };
    document.addEventListener('keydown', menuKeyHandler);
    // _closeRoleMenuで解除するため保持
    this._roleMenuKeyHandler = menuKeyHandler;
    const escapeKeyHandler = (e) => {
      if (!this._roleMenu || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this._closeRoleMenu();
      this._restoreRangeAfterRoleMenu(roleBtn.closest('.sn2-row'));
    };
    // document の capture listener が先に Escape を消費する画面でも
    // タイプメニューを確実に閉じられるよう、window capture で受ける。
    window.addEventListener('keydown', escapeKeyHandler, true);
    this._roleMenuEscapeKeyHandler = escapeKeyHandler;

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
        if (!menu.contains(ev.target) && ev.target !== roleBtn) this._closeRoleMenu();
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
    if (this._roleMenuEscapeKeyHandler) {
      window.removeEventListener('keydown', this._roleMenuEscapeKeyHandler, true);
      this._roleMenuEscapeKeyHandler = null;
    }
    if (this._roleMenu) {
      this._roleMenu.remove();
      this._roleMenu = null;
      this._roleMenuRow = null;
    }
  },

  _restoreRangeAfterRoleMenu(rowEl) {
    const textEl = rowEl?.querySelector('.sn2-text');
    if (!textEl) return;
    textEl.focus();
    if (this._roleMenuSavedRange) {
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(this._roleMenuSavedRange); }
      this._roleMenuSavedRange = null;
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

  _insertLinkFromRoleMenu(rowEl) {
    const textEl = rowEl?.querySelector('.sn2-text');
    if (!textEl || typeof showLinkInsertModal !== 'function') return;
    showLinkInsertModal(null, (result) => {
      if (!textEl.isConnected) return;
      this._insertLinkResultIntoText(textEl, null, result);
    });
  },

  _setRowRole(idx, rowEl, newRole) {
    const targetRow = this.doc.rows[idx];
    if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
      globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, targetRow, newRole);
      newRole = targetRow.role;
    } else {
      targetRow.role = newRole;
    }
    // dataset.kind: オプション設定 isBreak/isSummary/kind を反映
    const effective = globalThis.GBScriptNoteRoleModel?.getEffectiveRole?.(this.doc, targetRow);
    const charaForKind = effective?.type || effective?.style || (newRole
      ? this.doc.characters.find(c => !c.isDefault && c.name === newRole)
      : null);
    let kind = 'dialogue';
    if (!newRole) kind = 'blank';
    else if (charaForKind?.isSummary) kind = 'summary';
    else if (charaForKind?.isBreak) kind = 'break';
    else if (['dialogue', 'action', 'heading'].includes(charaForKind?.kind)) kind = charaForKind.kind;
    rowEl.dataset.kind = kind;
    // 枠線設定（タイプ個別のoutline）— 役割空時はデフォルトタイプから引く
    const outlineChara = effective?.style || (newRole
      ? this.doc.characters.find(c => !c.isDefault && c.name === newRole)
      : this.doc.characters.find(c => c.isDefault));
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
    // 旧形式のfallbackでは、未登録名を従来どおりキャラ候補へ追加する。
    if (!globalThis.GBScriptNoteRoleModel?.assignRowRole
      && newRole && !this.doc.characters.some(c => !c.isDefault && c.name === newRole)) {
      const newChara = this._createCharaFromTypeDefault(newRole);
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
    if (globalThis.GBScriptNoteRoleModel?.ensureDocument) {
      globalThis.GBScriptNoteRoleModel.ensureDocument(this.doc);
      return;
    }
    const registered = new Set(this.doc.characters.map(c => c.name));
    this.doc.rows.forEach(r => {
      if (r.role && !registered.has(r.role)) {
        const newChara = this._createCharaFromTypeDefault(r.role);
        this.doc.characters.push(newChara);
        registered.add(r.role);
      }
    });
  },

  _ensureTypeDefaultChara() {
    if (!this.doc) return null;
    if (!this.doc.editor) this.doc.editor = {};
    if (typeof ensureScriptNoteDefaultType === 'function') return ensureScriptNoteDefaultType(this.doc.editor);
    if (!this.doc.editor.defaultType) {
      this.doc.editor.defaultType = {
        isTypeDefault: true,
        name: '',
        roleStyle: { bgColor: '#333333' },
        textStyle: { bgColor: '#333333' },
      };
    }
    return this.doc.editor.defaultType;
  },

  _createCharaFromTypeDefault(name) {
    const source = this._ensureTypeDefaultChara() || {};
    let chara;
    try { chara = JSON.parse(JSON.stringify(source)); } catch { chara = { ...source }; }
    delete chara.isTypeDefault;
    delete chara.isDefault;
    chara.name = String(name || '').trim();
    // 「全行に適用（新規行にも反映）」の列ルールを新規タイプへ反映する
    // （2523156b でひな形方式へ移行した際に呼び出しが欠落していた）
    if (typeof this._applyColumnAllRules === 'function') this._applyColumnAllRules(chara);
    return chara;
  },

  // 役割が空の行に適用するデフォルトタイプ（isDefault: true）を末尾に常時 1 件保持する。
  // 複数あれば 1 件に統合し、末尾以外にあれば末尾へ移動する。
  _ensureDefaultChara() {
    if (!this.doc) return;
    if (globalThis.GBScriptNoteRoleModel?.ensureDocument) {
      globalThis.GBScriptNoteRoleModel.ensureDocument(this.doc);
      return;
    }
    this._ensureTypeDefaultChara();
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
    // （なし）行の大区切り/小区切り背景の初期値は透明。
    // bgColor キーが存在する場合（null=解除含む）はユーザー設定として保持する。
    // 一元化移行前（gutterStyleScopeVersion<2）に補完すると、移行が補完値を
    // 全タイプ共通スタイルとして editor.columnStyles へ昇格させるため、移行後のみ補完する。
    if (Number(this.doc.editor?.gutterStyleScopeVersion || 0) >= 2) {
      ['gutterStyle', 'gutter2Style'].forEach((key) => {
        let style = def[key];
        if (!style || typeof style !== 'object' || Array.isArray(style)) {
          style = {};
          def[key] = style;
        }
        if (!Object.prototype.hasOwnProperty.call(style, 'bgColor')) style.bgColor = 'transparent';
      });
    }
  },

  _getCharacterList() {
    if (globalThis.GBScriptNoteRoleModel?.buildRoleChoices) {
      return globalThis.GBScriptNoteRoleModel.buildRoleChoices(this.doc)
        .filter((choice) => choice?.kind !== 'none')
        .map((choice) => String(choice.name || choice.label || ''))
        .filter(Boolean);
    }
    const set = new Set();
    this.doc.characters.forEach(c => { if (!c.isDefault && c.name) set.add(c.name); });
    return Array.from(set).sort();
  },

});
