/* ==============================
   gb-note-block-context-menu.js: 右クリック/長押し/ハンドルメニューの
   「行種変更」サブメニュー統合 + 見出しリンクコピー
   計画書: app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
           §5 工程9（右クリック/長押しへの「行種変更」追加）
           §5 工程11 項目4（見出しへのリンクをコピー）
   依存: gb-note-block-types.js（MeldexNoteBlockTypes: resolveCurrentBlock 等）
         gb-note-block-menu.js（MeldexNoteBlockMenu: 共通行種メニュー本体）
         gb-editor.part03.part01.js（getOrAssignStableHeadingAnchorId, 読み取りのみ）

   利用元:
     - gb-editor.part04.part01.js の _noteCtxMenuHandler（右クリック/長押し。
       長押しは addLongPressHandler 経由で同じハンドラを再利用するため、
       このファイルを触らずに長押しでも同じ項目へ到達する）
     - gb-note-block-reorder.js の _openBlockMenuFor（ハンドルクリック。
       見出し限定で copyHeadingLink を extraAction として渡す）

   工程9-6（複数ブロック選択時の扱い）についての判断:
   右クリック/長押しの座標（caretRangeFromPoint優先）から「対象行1件」を解決し、
   選択範囲の広さに関わらずその1行だけをハイライトして明示する。複数ブロックの
   一括変換は別操作として今回は実装しない（実装量に対して需要が不明瞭なため。
   偶然の先頭行だけを変えてしまう既存の失敗パターンは、対象行を「選択範囲」ではなく
   「クリック位置」から解決することで回避している）。
   ============================== */
(function (global) {
  'use strict';

  // 対象行ハイライト（計画書2026-08-04版§2.3: gb-note-block-reorder.js の
  // ドラッグ捕捉ハイライトと同じ、gb-note-logical-rows.js の矩形オーバーレイを
  // 共有する。CSSアウトライン方式は子孫のリストまで枠取りしてしまうため廃止した）。
  let _activeHighlightBlock = null;

  function _setHighlight(block) {
    _clearHighlight();
    if (!block) return;
    const lr = global.MeldexNoteLogicalRows;
    if (lr) lr.showRowHighlight(block);
    // note-block-reorder-armed は既存E2E契約（targeted-note-micro-context-menu-
    // block-type-change、gb-e2e-actions-note-micro.js・対象外ファイル）が状態確認に
    // 使うため、状態フラグとして後方互換で併用する（対象CSS自体は対象外ファイル
    // 管轄。深いリストの正確な表示はオーバーレイ側を正とする）。
    if (block.classList) block.classList.add('note-block-reorder-armed');
    _activeHighlightBlock = block;
  }

  function _clearHighlight() {
    const lr = global.MeldexNoteLogicalRows;
    if (_activeHighlightBlock) {
      if (lr) lr.hideRowHighlight();
      if (_activeHighlightBlock.classList) _activeHighlightBlock.classList.remove('note-block-reorder-armed');
    }
    _activeHighlightBlock = null;
  }

  function _rangeAtBlockStart(block) {
    const r = document.createRange();
    r.selectNodeContents(block);
    r.collapse(true);
    return r;
  }

  // 工程9-1: 右クリック/長押し座標から対象の論理ブロック(行)を解決する。
  // caretRangeFromPoint が使える環境ではクリック座標を優先し、使えない/座標が
  // editable外を指す場合は fallbackNode（通常は e.target 由来の要素）位置へ
  // フォールバックする（gb-dnd.js の setCaretFromPoint と同じフォールバック方針）。
  function resolveBlockInfoForEvent(editable, e, fallbackNode) {
    const nbt = global.MeldexNoteBlockTypes;
    if (!nbt || !editable) return null;
    let range = null;
    try {
      if (typeof document.caretRangeFromPoint === 'function'
        && Number.isFinite(e?.clientX) && Number.isFinite(e?.clientY)
        && (e.clientX || e.clientY)) {
        const r = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (r && editable.contains(r.startContainer)) range = r;
      }
    } catch (_) { range = null; }
    if (!range) {
      const node = (fallbackNode && editable.contains(fallbackNode)) ? fallbackNode : editable;
      range = _rangeAtBlockStart(node);
    }
    return nbt.resolveCurrentBlock(editable, range);
  }

  // 工程9-2〜9-5: 右クリック/長押しメニュー用「行種変更」サブメニュートリガー。
  // ホバー(mouseenter)・クリック(タッチのタップ含む)・ArrowRight/Enter/Space の
  // いずれでも、共通行種メニュー(gb-note-block-menu.js)を対象行の右側(prefer:'right')
  // へ開く。サブメニューは親メニューDOMへ入れず、共通のfixedポップアップ配置
  // (positionPopup)をそのまま使う。
  function buildBlockTypeMenuTrigger(options) {
    const opts = options || {};
    const editable = opts.editable;
    const blockInfo = opts.blockInfo || null;
    const nbt = global.MeldexNoteBlockTypes;
    const menuApi = global.MeldexNoteBlockMenu;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'gb-context-menu-item has-submenu';
    trigger.setAttribute('role', 'menuitem');
    trigger.dataset.e2eId = 'note-ctx-block-type-trigger';
    trigger.textContent = '行種変更';

    const usable = !!(blockInfo && blockInfo.block && nbt && menuApi && editable && nbt.isEditableWritable(editable));
    if (!usable) {
      trigger.classList.add('disabled');
      trigger.disabled = true;
      trigger.setAttribute('aria-disabled', 'true');
      trigger.title = '変更できる行が見つかりません';
      return trigger;
    }

    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    const currentTypeId = nbt.getBlockTypeId(blockInfo);
    const setExpanded = (v) => trigger.setAttribute('aria-expanded', v ? 'true' : 'false');

    const openSubmenu = () => {
      if (!blockInfo.block.isConnected) return;
      setExpanded(true);
      // 工程9-6: 対象行を明示する（クリック位置から解決した1行だけをハイライト）。
      _setHighlight(blockInfo.block);
      menuApi.open({
        anchorRect: trigger.getBoundingClientRect(),
        prefer: 'right',
        editable,
        range: _rangeAtBlockStart(blockInfo.block),
        blockInfo,
        currentTypeId,
        onSelect: (typeId) => {
          // 選択までの間にDOMが変化している可能性があるため、対象ブロックから
          // 改めてRangeを作り直す(gb-note-block-reorder.js の _openBlockMenuFor と同じ方針)。
          const r = _rangeAtBlockStart(blockInfo.block.isConnected ? blockInfo.block : editable);
          nbt.convertCurrentLineTo(typeId, { editable, range: r });
          setExpanded(false);
          _clearHighlight();
          if (typeof opts.onAfterAction === 'function') opts.onAfterAction();
        },
        onClose: () => { setExpanded(false); _clearHighlight(); },
      });
    };
    const closeSubmenu = () => {
      if (menuApi.isOpen()) menuApi.close();
      setExpanded(false);
      _clearHighlight();
    };

    trigger.addEventListener('mouseenter', () => { if (!menuApi.isOpen()) openSubmenu(); });
    trigger.addEventListener('click', (ev) => {
      // メニューボタンのデフォルトフォーカス奪取でエディタのキャレットを崩さない
      // （親メニュー自体は mousedown で preventDefault 済みだが、念のため明示する）。
      ev.preventDefault();
      ev.stopPropagation();
      if (menuApi.isOpen()) closeSubmenu(); else openSubmenu();
    });
    trigger.addEventListener('keydown', (ev) => {
      if ((ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') && !menuApi.isOpen()) {
        ev.preventDefault();
        ev.stopPropagation();
        openSubmenu();
      }
    });

    return trigger;
  }

  // 工程11項目4: 見出しへの同一ノート内リンクをMarkdown形式でクリップボードへコピーする。
  // アンカーIDは getOrAssignStableHeadingAnchorId（gb-editor.part03.part01.js）で
  // 確保した既存の安定IDをそのまま使う。挿入用リンク（gb-link-modal.js の
  // insertHeadingLink）と同じ「#アンカーID」形式（同一ノート内リンクは常にこの形式。
  // inlinemd() の _noteAnchorIdFromHref がこの形式だけを認識する）。
  function copyHeadingLink(headingEl) {
    const fail = () => { if (typeof showStatus === 'function') showStatus('見出しへのリンクをコピーできませんでした', true); };
    if (!headingEl || typeof getOrAssignStableHeadingAnchorId !== 'function') { fail(); return false; }
    const editable = headingEl.closest?.('[contenteditable="true"]') || null;
    const existingLineId = headingEl.firstElementChild?.classList?.contains('_nl-id')
      ? (headingEl.firstElementChild.dataset?.lineId || '')
      : '';
    const anchorId = getOrAssignStableHeadingAnchorId(headingEl);
    if (!anchorId) { fail(); return false; }
    // 安定アンカーを初めて割り当てた場合、コピー操作だけで編集を終えても
    // <!--nl:...--> が保存されるよう、通常のdirty/自動保存経路へ流す。
    // これが無いと画面上のidだけが一時的に変わり、再読込後にコピー済みリンクが
    // 指す nl-* が消えてしまう。既存IDの再コピーでは余計な保存を発生させない。
    if (editable && existingLineId !== anchorId) {
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const label = (headingEl.textContent || '').replace(/\s+/g, ' ').trim() || '見出し';
    const text = `[${label}](#${anchorId})`;
    const done = () => { if (typeof showStatus === 'function') showStatus('見出しへのリンクをコピーしました'); };
    const legacyCopyFallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) { /* 環境非対応時は無視しdoneで完了扱いにする */ }
      ta.remove();
      done();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(legacyCopyFallback);
    } else {
      legacyCopyFallback();
    }
    return true;
  }

  global.MeldexNoteBlockContextMenu = {
    resolveBlockInfoForEvent,
    buildBlockTypeMenuTrigger,
    copyHeadingLink,
    clearHighlight: _clearHighlight,
  };
})(window);
