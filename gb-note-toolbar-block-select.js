/* ==============================
   gb-note-toolbar-block-select.js: ツールバーの行種選択（テーマ見本付きカスタムメニュー）
   計画書: app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
           §5 工程10（ツールバーの行種選択をテーマ見本付きカスタムメニューへ）
   依存: gb-note-block-types.js（MeldexNoteBlockTypes.TYPES/getType/resolveCurrentBlock/
         getBlockTypeId/canConvert/isEditableWritable/convertCurrentLineTo — 読み取りのみ、
         変更しない）, gb-editor.js（rtHeading, _rtEnsureEditableSelection — 既存のタイトル
         切替・選択キャプチャ経路をそのまま再利用）, gb-dropdown-dismiss.js
         （focusMeldexDropdownTrigger, bindMeldexDropdownKeySwitch, 外側クリック解除は
         .gb-context-menu クラスを継承することで自動適用）, meldex-core.js（lucide,
         positionPopup, clampPopupToViewport, showStatus）

   対象は `#page-rt-toolbar` 内の旧ネイティブ select（見出し/タイトル/本文選択）のみ。
   元の select と同じ範囲（タイトル・見出し1〜6・本文）に限定し、箇条書き等の他の行種は
   対象に含めない（それらは同ツールバー内の既存専用ボタンのまま）。

   gb-note-block-menu.js（`/`・ハンドル・右クリック・長押しが共有する共通メニュー本体）は
   工程4-9の既存APIを一切変更しない（並行レーンとの衝突回避のための制約）。
   このファイルは MeldexNoteBlockTypes の公開APIだけを読み取り専用で利用し、
   ポップアップ本体（配置・キーボード・ARIA・破棄）は既存の共通クラス
   （.gb-context-menu 系 CSS, positionPopup, gb-dropdown-dismiss の各ヘルパー）へ
   委譲することで、独自の重複実装を最小限に抑える。

   「タイトル」は工程4の行種レジストリの対象外（既存仕様のまま）。選択時は
   これまで通り rtHeading('TITLE') を呼ぶ。見出し1〜6・本文は
   MeldexNoteBlockTypes.convertCurrentLineTo() を呼ぶ（要件8: 独自変換を書かない）。
   ============================== */

(function (global) {
  'use strict';

  var TRIGGER_ID = 'page-rt-heading-btn';
  var TOOLBAR_HOST_ID = 'page-content';
  var MENU_ID = 'note-heading-toolbar-menu';
  var MENU_CLASS = 'gb-context-menu note-block-menu note-heading-toolbar-menu';
  var TOOLBAR_TYPE_IDS = ['title', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body'];
  var NEUTRAL_LABEL = '行の種類';
  var READONLY_REASON = '読み取り専用のため変更できません';

  var _menuEl = null;
  var _menuState = null; // { editable, range, blockInfo, currentTypeId, trigger }

  function _NBT() { return global.MeldexNoteBlockTypes; }

  function _icon(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size || 16) : '';
  }

  function _titleTypeDef() {
    return {
      id: 'title',
      label: 'タイトル',
      icon: 'heading',
      sampleTag: 'h1',
      sampleClass: 'note-title',
    };
  }

  function _resolveTypeDef(id) {
    if (id === 'title') return _titleTypeDef();
    var NBT = _NBT();
    return NBT && typeof NBT.getType === 'function' ? NBT.getType(id) : null;
  }

  function _toolbarDefs() {
    var defs = [];
    for (var i = 0; i < TOOLBAR_TYPE_IDS.length; i++) {
      var def = _resolveTypeDef(TOOLBAR_TYPE_IDS[i]);
      if (def) defs.push(def);
    }
    return defs;
  }

  function _trigger() { return document.getElementById(TRIGGER_ID); }
  function _pageContent() { return document.getElementById(TOOLBAR_HOST_ID); }

  // ============================================================
  // 現在の行種の解決（キャレット追従・要件4）
  // ============================================================
  function _resolveCurrentTypeId(editable, range) {
    var NBT = _NBT();
    if (!NBT || !editable || !range) return null;
    if (!editable.contains(range.startContainer)) return null;
    var info = NBT.resolveCurrentBlock(editable, range);
    if (!info) return null;
    if (info.kind === 'heading' && info.block.tagName === 'H1'
        && info.block.classList && info.block.classList.contains('note-title')) {
      return 'title';
    }
    var typeId = NBT.getBlockTypeId(info);
    return TOOLBAR_TYPE_IDS.indexOf(typeId) !== -1 ? typeId : null;
  }

  function _labelFor(id) {
    var def = _resolveTypeDef(id);
    return def ? def.label : NEUTRAL_LABEL;
  }

  function _syncTriggerLabel() {
    var trigger = _trigger();
    if (!trigger) return;
    var NBT = _NBT();
    var pageContent = _pageContent();
    var typeId = null;
    if (NBT && pageContent) {
      var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
      var range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (range && pageContent.contains(range.startContainer)) {
        typeId = _resolveCurrentTypeId(pageContent, range);
      }
    }
    var labelEl = trigger.querySelector('[data-role="label"]');
    var text = typeId ? _labelFor(typeId) : NEUTRAL_LABEL;
    if (labelEl) labelEl.textContent = text;
    trigger.setAttribute('aria-label', '行の種類を変更（現在: ' + text + '）');
    trigger.dataset.currentTypeId = typeId || '';
  }

  // キャレット移動・フォーカス移動のたびにボタン表示へ反映する。
  document.addEventListener('selectionchange', function () {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_syncTriggerLabel);
    else _syncTriggerLabel();
  });
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === TOOLBAR_HOST_ID) _syncTriggerLabel();
  });

  // ============================================================
  // 変換可否
  // ============================================================
  function _availability(id, editable, blockInfo) {
    var NBT = _NBT();
    if (!NBT || !NBT.isEditableWritable(editable)) {
      return { allowed: false, reason: READONLY_REASON };
    }
    if (id === 'title') return { allowed: true, reason: '' };
    return NBT.canConvert(id, editable, blockInfo);
  }

  // ============================================================
  // 変換の実行（要件8: convertCurrentLineTo を呼ぶ。独自変換を書かない）
  // ============================================================
  function _applyType(typeId, editable, range) {
    if (!editable) return { ok: false, reason: 'no-editable-host' };
    if (typeId === 'title') {
      // タイトルは行種レジストリの対象外（既存仕様のまま）。既存の
      // rtHeading('TITLE') / _rtApplyNoteTitle() 経路を維持する。
      if (typeof global.rtHeading === 'function') {
        global.rtHeading('TITLE');
        return { ok: true };
      }
      return { ok: false, reason: 'rtHeading-not-available' };
    }
    var NBT = _NBT();
    if (!NBT || typeof NBT.convertCurrentLineTo !== 'function') {
      return { ok: false, reason: 'registry-not-available' };
    }
    var result = NBT.convertCurrentLineTo(typeId, { editable: editable, range: range || undefined });
    if (result && !result.ok && !result.unchanged) {
      if (typeof global.showStatus === 'function') {
        global.showStatus(result.reason || '変換できませんでした', true);
      }
    }
    return result;
  }

  // ============================================================
  // テーマ／ファイルスタイルの見本描画
  // ============================================================
  // #page-content にはテーマ既定値に加え、ファイル単位の上書きが --page-* の
  // インラインCSS変数として直接設定されることがある（詳細パネルのスタイル設定）。
  // ポップアップは #page-content の子孫ではないため、その上書きだけを都度
  // ポップアップ自身へコピーする。CSS変数参照のまま反映するため、コピー後は
  // テーマ変更時も再描画なしで見本が追従する（要件7）。
  function _syncSampleThemeVars(menu, editable) {
    if (!menu) return;
    var existing = [];
    for (var i = 0; i < menu.style.length; i++) {
      var name = menu.style[i];
      if (name.indexOf('--page-') === 0) existing.push(name);
    }
    existing.forEach(function (name) { menu.style.removeProperty(name); });
    if (!editable || !editable.style) return;
    for (var j = 0; j < editable.style.length; j++) {
      var prop = editable.style[j];
      if (prop.indexOf('--page-') !== 0) continue;
      menu.style.setProperty(prop, editable.style.getPropertyValue(prop));
    }
  }

  function _buildSampleEl(def) {
    if (!def || !def.sampleTag) return null;
    var el = document.createElement(def.sampleTag);
    if (def.sampleClass) el.className = def.sampleClass;
    el.classList.add('note-heading-toolbar-sample');
    el.textContent = def.label;
    return el;
  }

  // ============================================================
  // ポップアップ本体
  // ============================================================
  function _ensureMenuEl() {
    if (_menuEl && _menuEl.isConnected) return _menuEl;
    var menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = MENU_CLASS;
    menu.dataset.e2eId = 'note-heading-toolbar-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '行の種類を選択');
    menu.style.display = 'none';
    document.body.appendChild(menu);
    // フォーカス保持中のポインタ操作でキャレットが飛ばないようにする（共通メニューと同方針）。
    menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
    // gb-dropdown-dismiss.js の共通「外側クリックで閉じる」処理からの契約
    // （.gb-context-menu は既存の DROPDOWN_SELECTORS に含まれるため自動適用される）。
    menu._cleanup = function () { closeMenu(); };
    _menuEl = menu;
    return menu;
  }

  function _renderItems() {
    var menu = _ensureMenuEl();
    var st = _menuState;
    menu.textContent = '';
    var defs = _toolbarDefs();
    defs.forEach(function (def, i) {
      var avail = _availability(def.id, st.editable, st.blockInfo);
      var isCurrent = def.id === st.currentTypeId;
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item note-block-menu-item' + (avail.allowed ? '' : ' disabled');
      item.dataset.typeId = def.id;
      item.dataset.e2eId = 'note-heading-toolbar-item-' + def.id;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', isCurrent ? 'true' : 'false');
      item.setAttribute('aria-disabled', avail.allowed ? 'false' : 'true');
      item.tabIndex = -1;
      var label = avail.allowed ? def.label : def.label + '（' + avail.reason + '）';
      item.setAttribute('aria-label', label);
      if (!avail.allowed) item.title = avail.reason;

      var icon = document.createElement('span');
      icon.className = 'slash-icon menu-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = _icon(def.icon, 16);
      item.appendChild(icon);

      var labelWrap = document.createElement('span');
      labelWrap.className = 'gb-context-menu-item-label note-block-menu-item-label';
      var sample = _buildSampleEl(def);
      if (sample) labelWrap.appendChild(sample);
      else labelWrap.textContent = def.label;
      item.appendChild(labelWrap);

      if (isCurrent) {
        var check = document.createElement('span');
        check.className = 'note-block-menu-current-mark';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = _icon('check', 14);
        item.appendChild(check);
      }
      if (!avail.allowed) {
        var reason = document.createElement('span');
        reason.className = 'note-block-menu-reason';
        reason.textContent = avail.reason;
        item.appendChild(reason);
      }

      item.addEventListener('click', function () { if (avail.allowed) _activate(def.id); });
      menu.appendChild(item);
    });
    return defs;
  }

  function _activate(typeId) {
    var st = _menuState;
    if (!st) return;
    var trigger = st.trigger;
    var editable = st.editable;
    var range = st.range;
    closeMenu();
    _applyType(typeId, editable, range);
    if (typeof global.focusMeldexDropdownTrigger === 'function') global.focusMeldexDropdownTrigger(trigger);
    else if (trigger && typeof trigger.focus === 'function') trigger.focus();
  }

  function _onMenuKeydown(e) {
    if (!_menuEl) return;
    var items = Array.prototype.slice.call(_menuEl.querySelectorAll('.note-block-menu-item'));
    if (!items.length) return;
    var idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      // ネイティブ select 相当: メニュー外へフォーカスが漏れないよう Tab も閉じてトリガーへ戻す。
      e.preventDefault();
      var trigger = _menuState && _menuState.trigger;
      closeMenu();
      if (typeof global.focusMeldexDropdownTrigger === 'function') global.focusMeldexDropdownTrigger(trigger);
      else if (trigger && typeof trigger.focus === 'function') trigger.focus();
    }
    // Enter/Space はネイティブ button の click に委譲する（追加処理不要）。
  }

  function openMenu(opts) {
    var NBT = _NBT();
    if (!NBT || !opts || !opts.editable || !opts.trigger) return false;
    var editable = opts.editable;
    var range = opts.range || null;
    var blockInfo = range ? NBT.resolveCurrentBlock(editable, range) : null;
    var currentTypeId = range ? _resolveCurrentTypeId(editable, range) : null;
    _menuState = {
      editable: editable,
      range: range,
      blockInfo: blockInfo,
      currentTypeId: currentTypeId,
      trigger: opts.trigger,
    };
    var menu = _ensureMenuEl();
    _syncSampleThemeVars(menu, editable);
    menu.style.display = '';
    var defs = _renderItems();
    menu.addEventListener('keydown', _onMenuKeydown);
    opts.trigger.setAttribute('aria-expanded', 'true');
    var rect = opts.trigger.getBoundingClientRect();
    if (typeof global.positionPopup === 'function') global.positionPopup(menu, rect, { gap: 4 });
    else if (typeof global.clampPopupToViewport === 'function') global.clampPopupToViewport(menu);
    var items = Array.prototype.slice.call(menu.querySelectorAll('.note-block-menu-item'));
    var selectedIndex = defs.findIndex(function (d) { return d.id === currentTypeId; });
    var target = items[selectedIndex >= 0 ? selectedIndex : 0];
    if (target && typeof target.focus === 'function') target.focus();
    return true;
  }

  function closeMenu() {
    if (_menuEl) {
      _menuEl.style.display = 'none';
      _menuEl.removeEventListener('keydown', _onMenuKeydown);
    }
    var trigger = _menuState && _menuState.trigger;
    _menuState = null;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function isOpen() {
    return !!(_menuEl && _menuEl.style.display !== 'none' && _menuState);
  }

  // ============================================================
  // トリガーボタン
  // ============================================================
  function toggle(event) {
    // data-action の click は document委譲のため event.currentTarget は document になる
    // （event.target.closest('[data-action]') 相当の解決は gb-events.js 側で完結している）。
    // トリガーは安定IDを持つ単一要素のため、常にIDで解決する。
    var trigger = (event && event.target && typeof event.target.closest === 'function'
      && event.target.closest('#' + TRIGGER_ID)) || _trigger();
    if (!trigger) return;
    if (isOpen()) { closeMenu(); return; }
    // 既存の rt* 系（gb-editor.js）と同じ選択キャプチャ経路を再利用する。
    // マウスクリックはツールバーの mousedown ハンドラが既に preventDefault 済みのため
    // #page-content 側のフォーカス・選択はそのまま保たれている。
    var editable = typeof global._rtEnsureEditableSelection === 'function'
      ? global._rtEnsureEditableSelection()
      : _pageContent();
    if (!editable || editable.id !== TOOLBAR_HOST_ID) {
      editable = _pageContent();
      if (!editable) return;
    }
    var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    var range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !editable.contains(range.startContainer)) {
      // フォールバック: 末尾へキャレットを置く（select要素にも「未選択」状態相当は無いため、
      // 現在行が特定できない場合は本文末尾を対象にする）。
      var fallbackRange = document.createRange();
      fallbackRange.selectNodeContents(editable);
      fallbackRange.collapse(false);
      range = fallbackRange;
    }
    openMenu({ trigger: trigger, editable: editable, range: range });
  }

  function _currentEditableRange() {
    var editable = _pageContent();
    if (!editable) return null;
    var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    var range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !editable.contains(range.startContainer)) return null;
    return { editable: editable, range: range };
  }

  function _initTrigger() {
    var trigger = _trigger();
    if (!trigger || typeof global.bindMeldexDropdownKeySwitch !== 'function') return;
    // ネイティブ select 相当: トリガーにフォーカスがある状態でも上下キーで直接切替できる
    // （プロジェクト共通のドロップダウン規約。メニューは開かない）。
    global.bindMeldexDropdownKeySwitch(trigger, {
      getItems: function () {
        return _toolbarDefs().map(function (d) { return { value: d.id, label: d.label }; });
      },
      getCurrentValue: function () { return trigger.dataset.currentTypeId || ''; },
      onSelect: function (item) {
        var ctx = _currentEditableRange();
        if (!ctx) return;
        _applyType(item.value, ctx.editable, ctx.range);
      },
      getFreshTrigger: function () { return _trigger(); },
    });
  }
  _initTrigger();

  global.MeldexNoteToolbarBlockSelect = {
    TOOLBAR_TYPE_IDS: TOOLBAR_TYPE_IDS.slice(),
    toggle: toggle,
    isOpen: isOpen,
    closeMenu: closeMenu,
    applyType: _applyType,
    syncTriggerLabel: _syncTriggerLabel,
  };
})(window);
