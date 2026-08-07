/* ==============================
   gb-note-block-menu.js: 行種レジストリ駆動の共通メニュー
   計画書: app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
           §4.3（共通メニュー仕様）§5 工程5（`/`を現在行の変換へ）
   依存: gb-note-block-types.js（MeldexNoteBlockTypes）, meldex-core.js
         （lucide, positionPopup, clampPopupToViewport, _getZoom）

   行種レジストリ（gb-note-block-types.js）から同じ項目順・状態で描画する
   共通ポップアップメニュー。利用元は `/`（工程5, 本ファイルの主対象）、
   ハンドルクリック・右クリック「行種変更」・タッチ長押し・ツールバー
   （いずれも工程7-10。ここでは open() の呼び出し口だけ用意し、配線は行わない）。

   共通要件（§4.3）:
   - body直下のfixedレイヤー / 画面外へ出ない配置（positionPopup + clampPopupToViewport）
   - 390px幅で横スクロールを発生させない（gb-note-block-menu.css）
   - Tab, Shift+Tab, 上下左右, Enter, Escape
   - ARIA role・現在選択・無効理由
   - 44px以上のタッチ対象（pointer:coarse メディアクエリ, gb-note-block-menu.css）
   - prefers-reduced-motion 追従（gb-note-block-menu.css）
   ============================== */

(function (global) {
  'use strict';

  const MENU_ID = 'note-block-menu';
  let _menuEl = null;
  let _state = null; // { items, selectedIndex, editable, range, currentTypeId, onSelect, onClose, query }

  function _icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 16) : '';
  }

  function _ensureMenuEl() {
    if (_menuEl && _menuEl.isConnected) return _menuEl;
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'gb-context-menu note-block-menu';
    menu.dataset.e2eId = 'note-block-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '行種を選択');
    menu.style.display = 'none';
    document.body.appendChild(menu);
    menu.addEventListener('mousedown', (e) => e.preventDefault()); // フォーカス奪取防止（現在の編集キャレットを保つ）
    // gb-dropdown-dismiss.js の共通「外側クリックで閉じる」処理は .gb-context-menu を
    // 対象に含み、既定では el.remove() するだけで本モジュールの _state を知らない。
    // el._cleanup があれば remove() の直前に呼ぶ契約になっているため、ここで
    // _state を正しくクリアして onClose を発火させ、外側クリックでの close も
    // Escape と同じ状態遷移にする（§5工程5-5「同じ状態機械で扱う」）。
    menu._cleanup = () => {
      const onClose = _state && _state.onClose;
      _state = null;
      if (typeof onClose === 'function') onClose();
    };
    _menuEl = menu;
    return menu;
  }

  function _matchesQuery(def, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if (def.label.toLowerCase().includes(q)) return true;
    if (def.id.includes(q)) return true;
    return (def.keywords || []).some((k) => k.toLowerCase().includes(q));
  }

  function _visibleItems() {
    if (!_state) return [];
    const NBT = global.MeldexNoteBlockTypes;
    return NBT.TYPES.filter((def) => _matchesQuery(def, _state.query));
  }

  function _itemAvailability(def) {
    const NBT = global.MeldexNoteBlockTypes;
    if (!NBT.isEditableWritable(_state.editable)) {
      return { allowed: false, reason: def.readOnlyState?.reasonText || '読み取り専用のため変更できません' };
    }
    return NBT.canConvert(def.id, _state.editable, _state.blockInfo);
  }

  function _render() {
    const menu = _ensureMenuEl();
    const items = _visibleItems();
    if (_state.selectedIndex >= items.length) _state.selectedIndex = Math.max(0, items.length - 1);
    menu.textContent = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-context-menu-label';
      empty.textContent = '一致する行種がありません';
      menu.appendChild(empty);
      return;
    }
    items.forEach((def, i) => {
      const avail = _itemAvailability(def);
      const isCurrent = def.id === _state.currentTypeId;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item note-block-menu-item' + (i === _state.selectedIndex ? ' selected' : '') + (avail.allowed ? '' : ' disabled');
      item.dataset.typeId = def.id;
      item.dataset.e2eId = 'note-block-menu-item-' + def.id;
      item.setAttribute('role', 'menuitemradio');
      // 行種は排他選択のため menuitemradio + aria-checked(現在の行種)。
      // キーボードの選択位置はフォーカスをエディタへ残す設計のため、
      // aria-selected(listbox用で本roleには不正)ではなく、メニュー側の
      // aria-activedescendant(下のrender末尾で設定)で支援技術へ伝える。
      item.id = 'note-block-menu-item-' + def.id;
      item.setAttribute('aria-checked', isCurrent ? 'true' : 'false');
      item.setAttribute('aria-disabled', avail.allowed ? 'false' : 'true');
      item.tabIndex = i === _state.selectedIndex ? 0 : -1;
      const label = avail.allowed ? def.label : def.label + '（' + avail.reason + '）';
      item.setAttribute('aria-label', label);
      if (!avail.allowed) item.title = avail.reason;

      const icon = document.createElement('span');
      icon.className = 'slash-icon menu-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = _icon(def.icon, 16);
      item.appendChild(icon);

      const labelEl = document.createElement('span');
      labelEl.className = 'gb-context-menu-item-label note-block-menu-item-label';
      labelEl.textContent = def.label;
      item.appendChild(labelEl);

      if (isCurrent) {
        const check = document.createElement('span');
        check.className = 'note-block-menu-current-mark';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = _icon('check', 14);
        item.appendChild(check);
      }

      if (!avail.allowed) {
        const reason = document.createElement('span');
        reason.className = 'note-block-menu-reason';
        reason.textContent = avail.reason;
        item.appendChild(reason);
      }

      item.addEventListener('click', () => { if (avail.allowed) _activate(def.id); });
      menu.appendChild(item);
    });
    // フォーカス非移動型メニューの選択位置通知(上の menuitemradio コメント参照)。
    const selectedItem = menu.querySelector('.note-block-menu-item.selected');
    if (selectedItem) menu.setAttribute('aria-activedescendant', selectedItem.id);
    else menu.removeAttribute('aria-activedescendant');
  }

  function _activate(typeId) {
    if (!_state) return;
    const onSelect = _state.onSelect;
    const editable = _state.editable;
    const range = _state.range;
    close();
    if (typeof onSelect === 'function') onSelect(typeId, { editable, range });
  }

  function _moveSelection(delta) {
    const items = _visibleItems();
    if (!items.length) return;
    // 無効項目もキーボードで選択できるようにする（無効理由を読めることが重要なため
    // スキップしない。§4.3「無効理由」の可視性を優先）。
    _state.selectedIndex = (_state.selectedIndex + delta + items.length) % items.length;
    _render();
  }

  // `/` からの利用ではキャレットがテキスト側に残ったまま（フィルタ入力を続けられる
  // ようにするため）実DOMフォーカスをメニューへ移さない。そのため上下左右キーの
  // 捕捉は document のcaptureフェーズで行う（旧 _onSlashKeydown と同じ方式）。
  // 工程7-10で右クリック等からメニューへ実フォーカスを移す呼び出し元が増えても、
  // capture フェーズが先に処理するため同じ経路でそのまま機能する。
  function _onDocumentKeydown(e) {
    if (!isOpen()) return;
    if (e.isComposing) return; // IME変換中は誤発火させない
    const key = e.key;
    if (key === 'ArrowDown' || (key === 'Tab' && !e.shiftKey)) {
      e.preventDefault(); e.stopPropagation();
      _moveSelection(1);
    } else if (key === 'ArrowUp' || (key === 'Tab' && e.shiftKey)) {
      e.preventDefault(); e.stopPropagation();
      _moveSelection(-1);
    } else if (key === 'ArrowRight' || key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      const items = _visibleItems();
      const def = items[_state.selectedIndex];
      if (def && _itemAvailability(def).allowed) _activate(def.id);
    } else if (key === 'ArrowLeft' || key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      const onClose = _state.onClose;
      close();
      if (typeof onClose === 'function') onClose();
    }
  }
  document.addEventListener('keydown', _onDocumentKeydown, true);

  function isOpen() {
    return !!(_menuEl && _menuEl.style.display !== 'none' && _state);
  }

  function close() {
    if (_menuEl) _menuEl.style.display = 'none';
    _state = null;
  }

  // options: { anchorRect, editable, range, blockInfo, currentTypeId, query, onSelect, onClose, prefer }
  // prefer: positionPopup() へそのまま渡す配置ヒント（'below'省略時 | 'right'）。
  // 工程9: 右クリック/長押しメニューの「行種変更」サブメニューは、行の下ではなく
  // トリガー項目の右側に開く必要があるため追加した（既存呼び出し元は省略時の
  // 'below'のまま挙動が変わらない。§4.3「サブメニュー対応のためのアンカー指定等」）。
  function open(options) {
    const opts = options || {};
    const NBT = global.MeldexNoteBlockTypes;
    if (!NBT || !opts.anchorRect || !opts.editable) return false;
    _state = {
      editable: opts.editable,
      range: opts.range || null,
      blockInfo: opts.blockInfo || null,
      currentTypeId: opts.currentTypeId || null,
      query: opts.query || '',
      selectedIndex: 0,
      onSelect: opts.onSelect || null,
      onClose: opts.onClose || null,
    };
    const menu = _ensureMenuEl();
    menu.style.display = '';
    _render();
    if (typeof positionPopup === 'function') {
      positionPopup(menu, opts.anchorRect, { gap: 4, prefer: opts.prefer || 'below' });
    } else {
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      menu.style.top = (opts.anchorRect.bottom / z + 4) + 'px';
      menu.style.left = (opts.anchorRect.left / z) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    return true;
  }

  function setQuery(query) {
    if (!_state) return;
    _state.query = query || '';
    _state.selectedIndex = 0;
    _render();
    if (_menuEl && typeof clampPopupToViewport === 'function') clampPopupToViewport(_menuEl);
  }

  global.MeldexNoteBlockMenu = {
    open,
    close,
    isOpen,
    setQuery,
    moveSelection: _moveSelection,
    activateSelected() {
      if (!_state) return;
      const items = _visibleItems();
      const def = items[_state.selectedIndex];
      if (def && _itemAvailability(def).allowed) _activate(def.id);
    },
  };
})(window);
