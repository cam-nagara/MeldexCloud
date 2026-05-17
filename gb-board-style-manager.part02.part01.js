/* gb-board-style-manager.part02.js: split from gb-board-style-manager.js */
// ============================================================
//  In-panel スタイル管理タブ & ドロップダウンポップアップ
// ============================================================

// ドロップダウンポップアップ (card/line 用)。ピッカー要素をアンカーにして
// 上または下にスタイル一覧 + アクションボタンを表示する。
let _bdStyleManagerPopup = null;
let _bdStyleManagerPopupAnchor = null;
let _bdStyleManagerPopupCloseHandler = null;
let _bdStyleManagerPopupDragId = null;
// 階層別スタイルタブで編集中の階層 index を保存する。
// bdRefreshSelectionDetails(true) → clearBoardDetailTabContent() でタブ DOM が
// 一旦空にされ、_bdEnsureBoardStyleManagerTabs() が再描画する際、selectedIndex を
// 渡さないと既定の 0 (階層1) に戻ってしまうため、UI 状態として保持する。
let _bdLastDepthEditIndex = 0;
// カードスタイル / ラインスタイルタブで編集中のスタイル id も同様に保存する。
// 何も選んでいない (= active) ときは null。selectedId 未指定時のフォールバックに使う。
let _bdLastCardEditId = null;
let _bdLastLineEditId = null;

function _bdCloseStyleManagerPopup() {
  _bdStyleManagerPopup?.remove();
  _bdStyleManagerPopup = null;
  _bdStyleManagerPopupAnchor = null;
  if (_bdStyleManagerPopupCloseHandler) {
    document.removeEventListener('pointerdown', _bdStyleManagerPopupCloseHandler);
    _bdStyleManagerPopupCloseHandler = null;
  }
}

function _bdStyleManagerPopupCloseButtonHtml() {
  if (typeof meldexDropdownCloseButtonHtml === 'function') {
    return meldexDropdownCloseButtonHtml({ className: 'bd-detail-style-action bd-style-manager-popup-close', attr: 'data-bd-popup-close' });
  }
  const closeIcon = typeof lucide === 'function' ? lucide('x', 14) : 'x';
  return `<button type="button" class="bd-detail-style-action bd-style-manager-popup-close" data-bd-popup-close title="閉じる" aria-label="閉じる">${closeIcon}</button>`;
}

function _bdFocusStyleManagerPopupAnchor(resolveAnchor) {
  const focus = () => { const el = typeof resolveAnchor === 'function' ? resolveAnchor() : resolveAnchor; if (!el?.isConnected || typeof el.focus !== 'function') return; try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } };
  focus(); setTimeout(focus, 0); if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
}

function _bdPositionStyleManagerPopup(popup, anchorEl) {
  if (!popup || !anchorEl?.getBoundingClientRect) return;
  const rect = anchorEl.getBoundingClientRect();
  if (typeof positionPopup === 'function') {
    positionPopup(popup, rect, { prefer: 'below', gap: 4 });
    return;
  }
  const zoom = typeof _getZoom === 'function' ? _getZoom() : 1;
  popup.style.left = (rect.left / zoom) + 'px';
  popup.style.top = (rect.bottom / zoom + 4) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
}

// card / line 用のスタイル選択ポップアップ。
// - options.onSelect(styleId): 選択時にタブ側を再描画するコールバック
// - options.kind: 'card' | 'line'
// - options.currentId: 現在タブで表示されているスタイル ID
// - options.refreshAnchor(): 再描画後に最新のアンカー要素 (ピッカーボタン) を返す。
//   タブの full re-render で旧アンカーが DOM 切断されると getBoundingClientRect() が
//   全 0 を返してしまい、ポップアップが画面左上に飛ぶのを防ぐために使う。
function _bdOpenStyleManagerPopup(kind, anchorEl, options) {
  if (!anchorEl) return;
  if (_bdStyleManagerPopup) {
    const same = _bdStyleManagerPopupAnchor === anchorEl;
    _bdCloseStyleManagerPopup();
    if (same) return;
  }
  bdEnsureBoardUiState();
  const opts = options || {};
  let currentAnchor = anchorEl;
  const popup = document.createElement('div');
  popup.className = 'bd-style-manager-popup';
  document.body.appendChild(popup);
  _bdStyleManagerPopup = popup;
  _bdStyleManagerPopupAnchor = currentAnchor;

  const render = () => {
    const displayStyles = _bdDisplayedManagedStyles(kind);
    const activeRef = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
    const activeStyleId = bd[activeRef] || '';
    const currentId = opts.currentId || activeStyleId;
    const itemLabel = kind === 'card' ? 'カードスタイル' : 'ラインスタイル';
    const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
    const copyIcon = typeof lucide === 'function' ? lucide('copy', 14) : '複製';
    const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
    const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : '戻す';
    const trashIcon = typeof lucide === 'function' ? lucide('trash2', 14) : '削除';
    const previewFn = kind === 'card' ? _bdCardStylePreviewHtml : _bdLineStylePreviewHtml;

    popup.innerHTML = `
      <div class="bd-style-manager-popup-list">
        ${displayStyles.map(style => `
          <div class="bd-style-list-item bd-style-list-item--draggable ${style.id === currentId ? 'active' : ''} ${style.id === activeStyleId ? 'is-applied' : ''}"
               data-bd-style-id="${_bdEscAttr(style.id)}" data-bd-style-item="${_bdEscAttr(style.id)}"
               draggable="true" tabindex="0" role="button">
            <span class="bd-style-list-handle" title="ドラッグして並べ替え">⋮⋮</span>
            <span class="bd-style-list-preview">${previewFn(style)}</span>
            <span class="bd-style-list-name">${esc(style.name)}</span>
            ${style.id === activeStyleId ? '<span class="bd-style-applied-mark" title="現在使用中">適用中</span>' : ''}
          </div>
        `).join('')}
      </div>
      <div class="bd-style-manager-popup-actions">
        <button type="button" class="bd-detail-style-action" data-bd-popup-add title="新しい${esc(itemLabel)}を追加">${plusIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-duplicate title="複製">${copyIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-save title="現在の設定をデフォルトとして保存">${saveIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-reset title="デフォルトに戻す">${resetIcon}</button>
        <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-bd-popup-delete title="削除" ${displayStyles.length <= 1 ? 'disabled' : ''}>${trashIcon}</button>
        ${_bdStyleManagerPopupCloseButtonHtml()}
      </div>`;

    // 位置決定: アンカーの下に出す (ピッカーが上部にあるので drop-down 優先)。
    // タブが re-render されて旧 anchor が DOM 切断されている場合は refreshAnchor で再取得し、
    // それでも取れなければ最後に有効だった矩形にフォールバックする。
    if (typeof opts.refreshAnchor === 'function') {
      const next = opts.refreshAnchor();
      if (next) {
        currentAnchor = next;
        _bdStyleManagerPopupAnchor = next;
      }
    }
    _bdPositionStyleManagerPopup(popup, currentAnchor);

    // リスト項目クリックでアクティブ選択変更
    popup.querySelectorAll('[data-bd-style-id]').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.bdStyleId;
        opts.currentId = id;
        if (typeof opts.onSelect === 'function') opts.onSelect(id);
        render();
      });
    });
    popup.querySelector('[data-bd-popup-close]')?.addEventListener('click', () => {
      _bdCloseStyleManagerPopup();
      _bdFocusStyleManagerPopupAnchor(() => typeof opts.refreshAnchor === 'function' ? (opts.refreshAnchor() || currentAnchor) : currentAnchor);
    });

    // D&D
    popup.querySelectorAll('[data-bd-style-item]').forEach(item => {
      item.addEventListener('dragstart', event => {
        _bdStyleManagerPopupDragId = item.dataset.bdStyleItem || null;
        item.classList.add('dragging');
        try { event.dataTransfer?.setData('text/plain', _bdStyleManagerPopupDragId || ''); } catch (_) {}
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        _bdStyleManagerPopupDragId = null;
        popup.querySelectorAll('[data-bd-style-item]').forEach(el => el.classList.remove('dragging', 'drag-over'));
      });
      item.addEventListener('dragover', event => {
        if (!_bdStyleManagerPopupDragId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => { item.classList.remove('drag-over'); });
      item.addEventListener('drop', event => {
        event.preventDefault();
        item.classList.remove('drag-over');
        const draggedId = _bdStyleManagerPopupDragId;
        const targetId = item.dataset.bdStyleItem || '';
        _bdStyleManagerPopupDragId = null;
        if (!draggedId || !targetId || draggedId === targetId) return;
        const arr = kind === 'card' ? bd.cardStyles : bd.lineStyles;
        const fromIdx = arr.findIndex(s => s.id === draggedId);
        const toIdx = arr.findIndex(s => s.id === targetId);
        if (fromIdx < 0 || toIdx < 0) return;
        bdPushUndo();
        const [moved] = arr.splice(fromIdx, 1);
        const finalIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
        arr.splice(finalIdx, 0, moved);
        bdDirty();
        bdRender();
        bdRefreshBoardToolbar();
        if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        render();
        if (typeof opts.onListChange === 'function') opts.onListChange(draggedId);
      });
    });

    const liveArr = () => kind === 'card' ? bd.cardStyles : bd.lineStyles;
    const currentLive = () => liveArr().find(s => s.id === (opts.currentId || activeStyleId)) || liveArr()[0];

    popup.querySelector('[data-bd-popup-add]')?.addEventListener('click', () => {
      bdPushUndo();
      const next = _bdNextStyle(kind, liveArr());
      bdDirty();
      opts.currentId = next.id;
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      if (typeof opts.onSelect === 'function') opts.onSelect(next.id);
      render();
    });

    popup.querySelector('[data-bd-popup-duplicate]')?.addEventListener('click', () => {
      const arr = liveArr();
      const live = currentLive(); if (!live) return;
      bdPushUndo();
      const next = _bdClone(live);
      next.id = _bdNormalizeStyleId(`${live.id}-copy-${Date.now().toString(36)}`, `${kind}-style-copy`);
      next.name = _bdMakeUniqueStyleName(`${live.name} コピー`, arr);
      arr.push(next);
      bdDirty();
      opts.currentId = next.id;
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      if (typeof opts.onSelect === 'function') opts.onSelect(next.id);
      render();
    });

    popup.querySelector('[data-bd-popup-save]')?.addEventListener('click', () => {
      const live = currentLive(); if (!live) return;
      bdPushUndo();
      live._default = _bdCloneStyleForDefault(live);
      _bdSaveGlobalStyleDefault(kind, live);
      bdDirty();
      showStatus(`${kind === 'card' ? 'カード' : 'ライン'}スタイル「${live.name}」をデフォルトとして保存しました`, false, { showSaveDialog: true });
      render();
    });

    popup.querySelector('[data-bd-popup-reset]')?.addEventListener('click', () => {
      const live = currentLive(); if (!live) return;
      bdPushUndo();
      _bdResetStyleToDefault(kind, live);
      bdDirty();
      bdRender();
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      if (typeof opts.onSelect === 'function') opts.onSelect(live.id);
      render();
      showStatus(`${kind === 'card' ? 'カード' : 'ライン'}スタイル「${live.name}」をデフォルトに戻しました`);
    });

    popup.querySelector('[data-bd-popup-delete]')?.addEventListener('click', async () => {
      if (liveArr().length <= 1) return;
      const live = currentLive(); if (!live) return;
      const activeRefKey = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
      const unitLabel = kind === 'card' ? 'カード' : 'ライン';
      const usage = _bdCountStyleUsage(kind, live.id);
      const usageMsg = usage > 0 ? `\n\nこのスタイルは ${usage} 個の${unitLabel}で使用中です。削除すると、それらは別のスタイルに切り替わります。` : '';
      const ok = typeof cfConfirm === 'function' ? await cfConfirm(`${kind === 'card' ? 'カード' : 'ライン'}スタイル「${live.name}」を削除しますか？${usageMsg}`) : true;
      if (!ok) return;
      const arr = liveArr();
      const liveIndex = arr.findIndex(style => style.id === live.id);
      if (liveIndex < 0) return;
      bdPushUndo();
      const removedId = arr[liveIndex].id;
      arr.splice(liveIndex, 1);
      _bdRemoveGlobalStyleDefault(kind, removedId);
      const remainingDisplay = _bdDisplayedManagedStyles(kind);
      const fallbackId = remainingDisplay[0]?.id || arr[0]?.id || '';
      if (bd[activeRefKey] === removedId) bd[activeRefKey] = fallbackId;
      if (kind === 'card') {
        (bd.nodes || []).forEach(node => { if (node && node.cardStyle === removedId) node.cardStyle = fallbackId; });
      } else {
        (bd.connections || []).forEach(conn => { if (conn && conn.styleRef === removedId) conn.styleRef = fallbackId; });
      }
      if (typeof _bdReplaceDeletedStyleRefsInDepthStyles === 'function') {
        _bdReplaceDeletedStyleRefsInDepthStyles(kind, removedId, fallbackId);
      }
      bdDirty();
      bdRender();
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      opts.currentId = fallbackId;
      if (typeof opts.onSelect === 'function') opts.onSelect(fallbackId);
      render();
      showStatus(`${kind === 'card' ? 'カード' : 'ライン'}スタイル「${live.name}」を削除しました`);
    });
  };

  render();

  setTimeout(() => {
    _bdStyleManagerPopupCloseHandler = event => {
      if (!_bdStyleManagerPopup) return;
      const anchor = _bdStyleManagerPopupAnchor || currentAnchor;
      if (!_bdStyleManagerPopup.contains(event.target) && !(anchor && anchor.contains(event.target))) {
        _bdCloseStyleManagerPopup();
      }
    };
    document.addEventListener('pointerdown', _bdStyleManagerPopupCloseHandler);
  }, 0);
}

// 指定 kind のスタイル管理をオプションパネルのタブ内にレンダリングする。
// 上部: ピッカーボタン (クリックでドロップダウンポップアップが開く: list + actions)
// 下部: 選択中スタイルの編集フィールド (左カラムの大きなプレビュー枠は廃止)
// mode === 'diff' はフィールド入力途中の再描画用。container.innerHTML を作り直すと
// 入力中の <input> がガベコレされ、フォーカスと IME 変換候補が飛ぶので、
// メタ・ピッカー表示だけを差分更新する。
// style 追加/削除/複製/reset やピッカー経由の選択変更時は 'full' で呼び、全再構築する。
function _bdRenderStyleManagerInPanel(kind, container, selectedId, mode) {
  if (!container) return;
  bdEnsureBoardUiState();
  const activeRef = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
  const displayStyles = _bdDisplayedManagedStyles(kind);
  if (!displayStyles.length) {
    container.innerHTML = `<div class="bd-detail-hint">表示できるスタイルがありません。</div>`;
    return;
  }
  // selectedId 未指定時は、最後に編集していた id → active style → 先頭の順で採用する。
  // bdRefreshSelectionDetails(true) によるタブ再描画で active style へ強制復帰しないようにする。
  const lastIdRef = kind === 'card' ? _bdLastCardEditId : _bdLastLineEditId;
  const effectiveId = selectedId || lastIdRef || bd[activeRef] || displayStyles[0].id;
  const selected = displayStyles.find(s => s.id === effectiveId) || displayStyles[0];
  if (kind === 'card') _bdLastCardEditId = selected.id;
  else _bdLastLineEditId = selected.id;
  const itemLabel = kind === 'card' ? 'カードスタイル' : 'ラインスタイル';
  const unitLabel = kind === 'card' ? 'カード' : 'ライン';
  const activeStyleId = bd[activeRef] || '';
  const isSelectedActive = selected.id === activeStyleId;
  const usageCount = _bdCountStyleUsage(kind, selected.id);
  const previewFn = kind === 'card' ? _bdCardStylePreviewHtml : _bdLineStylePreviewHtml;
  const metaText = `${selected.name} ・ ${usageCount > 0 ? `${usageCount} 個の${unitLabel}が使用中` : `使用中の${unitLabel}なし`}${isSelectedActive ? ' ・ 現在使用中' : ''}`;
  const pickerLabelText = `${selected.name}${isSelectedActive ? ' (適用中)' : ''}`;
  const exportIcon = typeof lucide === 'function' ? lucide('download', 14) : '書出';

  if (mode === 'diff' && container.querySelector('[data-bd-style-in-panel]')) {
    const metaEl = container.querySelector('.bd-style-editor-meta');
    if (metaEl) metaEl.textContent = metaText;
    const pickerPreview = container.querySelector('.bd-style-picker-preview');
    if (pickerPreview) pickerPreview.innerHTML = previewFn(selected);
    const pickerLabel = container.querySelector('.bd-style-picker-label');
    if (pickerLabel) pickerLabel.textContent = pickerLabelText;
    const pickerBtn = container.querySelector('[data-bd-style-panel-picker]');
    if (pickerBtn) pickerBtn.dataset.bdCurrentStyleId = selected.id;
    return;
  }

  // プレビュードロップダウン (ピッカー) は最上部、編集フィールドはその下に。
  // 上段の大きなプレビュー枠は削除し、設定項目を縦 1 カラムで詰めて表示する。
  container.innerHTML = `
    <div class="bd-detail-panel bd-style-in-panel" data-bd-style-in-panel="${_bdEscAttr(kind)}">
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">${esc(itemLabel)}一覧を開く</div>
        <button type="button" class="bd-style-panel-picker" data-bd-style-panel-picker="${_bdEscAttr(kind)}" data-bd-current-style-id="${_bdEscAttr(selected.id)}" aria-label="${esc(itemLabel)}一覧を開く">
          <span class="bd-style-picker-preview">${previewFn(selected)}</span>
          <span class="bd-style-picker-label">${esc(pickerLabelText)}</span>
          <span class="bd-style-picker-caret" aria-hidden="true">▾</span>
        </button>
        <button type="button" class="bd-detail-style-action" data-e2e-id="bd-style-panel-export-board-styles" data-bd-style-panel-export-board-styles title="ボードスタイルを書き出し" aria-label="ボードスタイルを書き出し">${exportIcon}</button>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">${esc(itemLabel)}</div>
        <div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-panel-fields></div>
        <div class="bd-style-editor-meta">${esc(metaText)}</div>
      </div>
    </div>`;

  const fieldsEl = container.querySelector('[data-bd-panel-fields]');
  // beforeEdit: bdEnsureBoardUiState / bdNormalize*Styles は呼び出しごとに bd.cardStyles /
  // bd.lineStyles を新配列 + 新オブジェクトへ差し替えるため、closure で掴んだ OLD selected は
  // 1 回目の diff 再レンダー後に orphan になる。2 回目以降のフィールド編集で OLD を
  // mutate すると mutation が bd.*Styles へ伝播せず失われる。毎回 ID から live な参照を
  // 取り直すことで、fields を再構築しない diff モードでも mutation が正しく保存される。
  _bdBuildStyleFields(fieldsEl, kind, selected, (field) => {
    const needsFullRebuild = typeof _bdStyleFieldNeedsFullRebuild === 'function'
      && _bdStyleFieldNeedsFullRebuild(kind, field);
    bdDirty();
    if (field === 'fontFamily') {
      if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
    } else {
      bdRender();
    }
    _bdRenderStyleManagerInPanel(kind, container, selected.id, needsFullRebuild ? undefined : 'diff');
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  }, {
    e2eScope: `${kind}-panel-${selected.id}`,
    beforeEdit: () => {
      const arr = kind === 'card' ? bd.cardStyles : bd.lineStyles;
      return (arr || []).find(s => s.id === selected.id) || (arr || [])[0] || null;
    },
  });

  const pickerBtn = container.querySelector('[data-bd-style-panel-picker]');
  container.querySelector('[data-bd-style-panel-export-board-styles]')?.addEventListener('click', () => {
    if (typeof bdExportBoardStylePack === 'function') bdExportBoardStylePack();
    else if (typeof showStatus === 'function') showStatus('ボードスタイル書き出し機能を初期化できませんでした', true);
  });
  pickerBtn?.addEventListener('click', () => {
    _bdOpenStyleManagerPopup(kind, pickerBtn, {
      currentId: selected.id,
      onSelect: (styleId) => {
        _bdRenderStyleManagerInPanel(kind, container, styleId);
      },
      onListChange: (styleId) => {
        _bdRenderStyleManagerInPanel(kind, container, styleId);
      },
      // タブ再描画でピッカーボタンが新規 DOM に置き換わるため、ポップアップ
      // 位置計算前に最新の DOM を取り直す。これがないと旧ボタンの矩形 (0,0,0,0)
      // が使われてポップアップが画面左上に飛ぶ。
      refreshAnchor: () => container.querySelector('[data-bd-style-panel-picker]'),
    });
  });
  if (typeof bindMeldexDropdownKeySwitch === 'function') {
    bindMeldexDropdownKeySwitch(pickerBtn, {
      getItems: () => _bdDisplayedManagedStyles(kind).map(style => ({ value: style.id, style })),
      getCurrentValue: () => pickerBtn.dataset.bdCurrentStyleId || selected.id,
      onSelect: item => _bdRenderStyleManagerInPanel(kind, container, item.value),
      getFreshTrigger: () => container.querySelector('[data-bd-style-panel-picker]'),
    });
  }
}

function _bdDepthPickerLabel(style, index, total) {
  const name = typeof bdDepthStyleDisplayName === 'function'
    ? bdDepthStyleDisplayName(style, index, total)
    : `階層 ${Math.max(0, index | 0) + 1}`;
  const defaultText = style?.defaultText ? ` (${style.defaultText})` : '';
  return `${name}${defaultText}`;
}

function _bdStyleRefOptions(kind) {
  const styles = typeof _bdDisplayedManagedStyles === 'function'
    ? _bdDisplayedManagedStyles(kind)
    : (kind === 'card' ? (bd.cardStyles || []) : (bd.lineStyles || []));
  const label = kind === 'card' ? '個別カード設定' : '個別ライン設定';
  return [
    { v: '', l: label },
    ...(styles || []).map(style => ({ v: style.id || '', l: style.name || style.id || 'スタイル' })),
  ];
}

function _bdApplyStyleRefToDepth(depth, kind, styleId) {
  if (!depth) return;
  const id = String(styleId || '');
  if (kind === 'card') {
    depth.cardStyleRef = id;
    if (!id) return;
    const source = (bd.cardStyles || []).find(style => style && style.id === id);
    const snap = typeof _bdCloneStyleForDefault === 'function'
      ? _bdCloneStyleForDefault(source)
      : (source ? { ...source } : null);
    if (!snap) return;
    Object.keys(snap).forEach(key => { depth[key] = snap[key]; });
    return;
  }
  depth.lineStyleRef = id;
  if (!depth.line || typeof depth.line !== 'object') depth.line = {};
  if (!id) return;
  const source = (bd.lineStyles || []).find(style => style && style.id === id);
  const snap = typeof _bdCloneStyleForDefault === 'function'
    ? _bdCloneStyleForDefault(source)
    : (source ? { ...source } : null);
  if (!snap) return;
  Object.keys(snap).forEach(key => { depth.line[key] = snap[key]; });
}

function _bdReplaceDeletedStyleRefsInDepthStyles(kind, removedId, fallbackId) {
  if (!removedId || typeof bd === 'undefined') return;
  const key = kind === 'card' ? 'cardStyleRef' : 'lineStyleRef';
  (bd.depthStyles || []).forEach(depth => {
    if (!depth || depth[key] !== removedId) return;
    _bdApplyStyleRefToDepth(depth, kind, fallbackId || '');
  });
}

function _bdAppendDepthStyleRefRow(container, kind, selected, liveDepth, onApply) {
  const fmt = window.gbFmt;
  if (!container || !fmt) return;
  const row = fmt.makeRow({ wrap: true });
  row.classList.add('bd-depth-style-ref-row');
  const label = fmt.makeLabel(kind === 'card' ? '元カードスタイル' : '元ラインスタイル');
  const value = kind === 'card' ? (selected.cardStyleRef || '') : (selected.lineStyleRef || '');
  const select = fmt.makeSelect({
    opts: _bdStyleRefOptions(kind),
    value,
    onChange: (nextId) => {
      const live = typeof liveDepth === 'function' ? liveDepth() : selected;
      if (!live) return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      _bdApplyStyleRefToDepth(live, kind, nextId);
      if (typeof onApply === 'function') onApply();
    },
  });
  select.setAttribute('data-bd-depth-style-ref', kind);
  select.setAttribute('data-e2e-id', `bd-depth-${kind}-style-ref`);
  row.appendChild(label);
  row.appendChild(select);
  container.appendChild(row);
}

// 階層別スタイル用の in-panel 版。mode は _bdRenderStyleManagerInPanel と同じ役割で
// 'diff' のときは入力中のフォーカスを壊さないよう差分更新のみ行う。
function _bdRenderDepthStyleInPanel(container, selectedIndex, mode) {
  if (!container) return;
  if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
  const styles = bd.depthStyles || [];
  if (!styles.length) {
    bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles([]) : [];
  }
  const liveStyles = () => bd.depthStyles || [];
  // selectedIndex 未指定時は、最後に編集していた階層 index を採用する。
  // これがないと bdRefreshSelectionDetails(true) で発生するタブ再描画のたびに
  // 0 (階層1) に戻ってしまい、ライン色等の編集中に「階層1に戻された」ように見える。
  const fallbackIdx = Number.isFinite(+_bdLastDepthEditIndex) ? +_bdLastDepthEditIndex : 0;
  const rawIdx = Number.isFinite(+selectedIndex) ? +selectedIndex : fallbackIdx;
  const idx = Math.max(0, Math.min(rawIdx, liveStyles().length - 1));
  _bdLastDepthEditIndex = idx;
  const selected = liveStyles()[idx] || liveStyles()[0];
  const previewHtml = _bdDepthStylePreviewHtml(selected);
  const pickerLabelText = _bdDepthPickerLabel(selected, idx, liveStyles().length);

  if (mode === 'diff' && container.querySelector('[data-bd-style-in-panel="depth"]')) {
    const pickerPreview = container.querySelector('.bd-style-picker-preview');
    if (pickerPreview) pickerPreview.innerHTML = previewHtml;
    const pickerLabel = container.querySelector('.bd-style-picker-label');
    if (pickerLabel) pickerLabel.textContent = pickerLabelText;
    const pickerBtn = container.querySelector('[data-bd-depth-panel-picker]');
    if (pickerBtn) pickerBtn.dataset.bdDepthCurrentIndex = String(idx);
    const nameInput = container.querySelector('[data-bd-depth-name]');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = selected?.name || '';
    const cardRef = container.querySelector('[data-bd-depth-style-ref="card"]');
    if (cardRef && document.activeElement !== cardRef) cardRef.value = selected?.cardStyleRef || '';
    const lineRef = container.querySelector('[data-bd-depth-style-ref="line"]');
    if (lineRef && document.activeElement !== lineRef) lineRef.value = selected?.lineStyleRef || '';
    return;
  }

  // プレビュードロップダウン (ピッカー) は最上部、編集フィールドはその下に。
  // 上段の大きなプレビュー枠は削除し、設定項目を縦 1 カラムで詰めて表示する。
  container.innerHTML = `
    <div class="bd-detail-panel bd-style-in-panel bd-depth-in-panel" data-bd-style-in-panel="depth">
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">階層一覧を開く</div>
        <div class="bd-detail-style-row">
          <button type="button" class="bd-style-panel-picker" data-bd-depth-panel-picker="depth" data-bd-depth-current-index="${idx}" aria-label="階層一覧を開く">
            <span class="bd-style-picker-preview">${previewHtml}</span>
            <span class="bd-style-picker-label">${esc(pickerLabelText)}</span>
            <span class="bd-style-picker-caret" aria-hidden="true">▾</span>
          </button>
          <button type="button" class="bd-detail-style-action" data-bd-depth-apply-theme title="テーマカラーを階層別スタイルに適用">${typeof lucide === 'function' ? lucide('palette', 14) : '色'}</button>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">階層別スタイル</div>
        <div class="bd-style-editor-fields bd-style-editor-fields--fmt bd-depth-fields" data-bd-depth-fields></div>
      </div>
    </div>`;

  const depthFieldsEl = container.querySelector('[data-bd-depth-fields]');
  const applyDepthStyles = (options = {}) => {
    if (typeof bdNormalizeDepthStyles === 'function') bd.depthStyles = bdNormalizeDepthStyles(bd.depthStyles);
    if (!options.fontOnly) _bdApplyAllAutoStyles();
    bdDirty();
    if (options.fontOnly) {
      if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
    } else {
      bdRender();
    }
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  if (depthFieldsEl && selected && window.gbFmt) {
    const depthEmit = (styleKind, field) => {
      const needsFullRebuild = typeof _bdStyleFieldNeedsFullRebuild === 'function'
        && _bdStyleFieldNeedsFullRebuild(styleKind, field);
      applyDepthStyles({ fontOnly: field === 'fontFamily' });
      _bdRenderDepthStyleInPanel(container, idx, needsFullRebuild ? undefined : 'diff');
    };
    // bdNormalizeDepthStyles が applyDepthStyles の度に bd.depthStyles[idx] を新オブジェクトに
    // 差し替えるため、closure の selected / selected.line は 1 回目の diff 再レンダー後に orphan
    // となる。fields を再構築しない diff モードでは、beforeEdit で毎回 idx から live な参照を
    // 取り直さないと 2 回目以降のフィールド編集 mutation が保存されない。
    const liveDepth = () => (bd.depthStyles || [])[idx] || null;
    const fmt = window.gbFmt;

    const nameRow = document.createElement('div');
    nameRow.className = 'bd-style-name-row bd-depth-style-name-row';
    const nameLbl = document.createElement('span');
    nameLbl.className = 'gb-fmt-label';
    nameLbl.textContent = '階層別スタイル名';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = selected.name || '';
    nameInp.placeholder = `階層 ${idx + 1}`;
    nameInp.className = 'bd-style-name-input';
    nameInp.setAttribute('data-bd-depth-name', 'true');
    nameInp.setAttribute('data-e2e-id', `bd-depth-panel-${idx}-name`);
    nameInp.setAttribute('aria-label', '階層別スタイル名');
    nameInp.addEventListener('change', () => {
      const live = liveDepth();
      if (!live) return;
      const nextName = String(nameInp.value || '').trim();
      if ((live.name || '') === nextName) return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      live.name = nextName;
      depthEmit('', undefined);
    });
    nameRow.append(nameLbl, nameInp);
    depthFieldsEl.appendChild(nameRow);

    // カードスタイル部
    const cardHeader = document.createElement('div');
    cardHeader.className = 'bd-detail-section-title';
    cardHeader.textContent = 'カードスタイル';
    depthFieldsEl.appendChild(cardHeader);
    _bdAppendDepthStyleRefRow(depthFieldsEl, 'card', selected, liveDepth, () => {
      applyDepthStyles();
      _bdRenderDepthStyleInPanel(container, idx);
    });
    const cardFieldsWrap = document.createElement('div');
    cardFieldsWrap.className = 'bd-depth-style-field-group';
    depthFieldsEl.appendChild(cardFieldsWrap);
    _bdBuildStyleFields(cardFieldsWrap, 'card', selected, field => depthEmit('card', field), {
      hideName: true,
      e2eScope: `depth-panel-${idx}-card`,
      beforeEdit: liveDepth,
    });

    // デフォルトテキスト
    const defRow = fmt.makeRow({ wrap: true });
    const defInput = document.createElement('input');
    defInput.type = 'text';
    defInput.value = selected.defaultText != null ? selected.defaultText : 'カード';
    defInput.placeholder = 'カード追加時に自動で入る文字';
    defInput.title = '新規カード追加時のテキスト';
    defInput.style.cssText = 'flex:1;min-width:160px;padding:3px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
    defInput.addEventListener('change', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      // 同じく orphan 回避のため、書き込み直前に live 参照を取り直す。
      const live = liveDepth();
      if (live) live.defaultText = defInput.value;
      depthEmit('', undefined);
    });
    defRow.appendChild(fmt.makeLabel('デフォルトテキスト'));
    defRow.appendChild(defInput);
    depthFieldsEl.appendChild(defRow);

    // ラインスタイル部
    const lineHeader = document.createElement('div');
    lineHeader.className = 'bd-detail-section-title';
    lineHeader.style.marginTop = '12px';
    lineHeader.textContent = 'ラインスタイル（この階層のカードから出るライン）';
    depthFieldsEl.appendChild(lineHeader);
    _bdAppendDepthStyleRefRow(depthFieldsEl, 'line', selected, liveDepth, () => {
      applyDepthStyles();
      _bdRenderDepthStyleInPanel(container, idx);
    });
    if (!selected.line || typeof selected.line !== 'object') {
      selected.line = { color: '', width: 2, style: '', arrow: 'end', pathType: 'curve' };
    }
    const lineFieldsWrap = document.createElement('div');
    lineFieldsWrap.className = 'bd-depth-style-field-group';
    depthFieldsEl.appendChild(lineFieldsWrap);
    _bdBuildStyleFields(lineFieldsWrap, 'line', selected.line, field => depthEmit('line', field), {
      hideName: true,
      e2eScope: `depth-panel-${idx}-line`,
      beforeEdit: () => {
        const live = liveDepth();
        if (!live) return null;
        if (!live.line || typeof live.line !== 'object') {
          live.line = { color: '', width: 2, style: '', arrow: 'end', pathType: 'curve' };
        }
        return live.line;
      },
    });
  }

  const pickerBtn = container.querySelector('[data-bd-depth-panel-picker]');
  pickerBtn?.addEventListener('click', () => {
    _bdOpenDepthStyleManagerPopup(pickerBtn, {
      currentIndex: idx,
      onSelect: (nextIdx) => {
        _bdLastDepthEditIndex = Math.max(0, Math.min(+nextIdx || 0, (bd.depthStyles || []).length - 1));
        _bdRenderDepthStyleInPanel(container, nextIdx);
      },
      // タブ再描画でピッカーボタンが新規 DOM に置き換わるため、ポップアップ
      // 位置計算前に最新の DOM を取り直す。これがないと旧ボタンの矩形 (0,0,0,0)
      // が使われてポップアップが画面左上に飛ぶ。
      refreshAnchor: () => container.querySelector('[data-bd-depth-panel-picker]'),
    });
  });
  container.querySelector('[data-bd-depth-apply-theme]')?.addEventListener('click', () => {
    if (typeof bdApplyThemeColorsToDepthStyles !== 'function') return;
    if (typeof bdPushUndo === 'function') bdPushUndo();
    bdApplyThemeColorsToDepthStyles({ applyLineColor: true });
    applyDepthStyles();
    _bdRenderDepthStyleInPanel(container, idx);
    if (typeof showStatus === 'function') showStatus('テーマカラーを階層別スタイルに適用しました');
  });
  if (typeof bindMeldexDropdownKeySwitch === 'function') {
    bindMeldexDropdownKeySwitch(pickerBtn, {
      getItems: () => (bd.depthStyles || []).map((style, index) => ({ value: String(index), style })),
      getCurrentValue: () => pickerBtn.dataset.bdDepthCurrentIndex || String(idx),
      onSelect: (_item, nextIndex) => _bdRenderDepthStyleInPanel(container, nextIndex),
      getFreshTrigger: () => container.querySelector('[data-bd-depth-panel-picker]'),
    });
  }
}

// 階層別スタイル用のポップアップ (list + add/save/reset/delete アクション)。
let _bdDepthStyleDragIndex = -1;
function _bdOpenDepthStyleManagerPopup(anchorEl, options) {
  if (!anchorEl) return;
  if (_bdStyleManagerPopup) {
    const same = _bdStyleManagerPopupAnchor === anchorEl;
    _bdCloseStyleManagerPopup();
    if (same) return;
  }
  if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
  const opts = options || {};
  let currentAnchor = anchorEl;
  const popup = document.createElement('div');
  popup.className = 'bd-style-manager-popup bd-depth-manager-popup';
  document.body.appendChild(popup);
  _bdStyleManagerPopup = popup;
  _bdStyleManagerPopupAnchor = currentAnchor;

  const applyDepthStyles = (renderCb) => {
    if (typeof bdNormalizeDepthStyles === 'function') bd.depthStyles = bdNormalizeDepthStyles(bd.depthStyles);
    _bdApplyAllAutoStyles();
    bdDirty();
    bdRender();
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    if (typeof renderCb === 'function') renderCb();
  };

  const render = () => {
    const styles = bd.depthStyles || [];
    let currentIndex = Math.max(0, Math.min(Number.isFinite(+opts.currentIndex) ? +opts.currentIndex : 0, styles.length - 1));
    const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
    const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
    const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : '戻す';
    const trashIcon = typeof lucide === 'function' ? lucide('trash2', 14) : '削除';
    const paletteIcon = typeof lucide === 'function' ? lucide('palette', 14) : '色';

    popup.innerHTML = `
      <div class="bd-style-manager-popup-list">
        ${styles.map((style, i) => {
          const tooltip = _bdEscAttr(_bdDepthStyleTooltip(style, i, styles.length));
          return `<div class="bd-style-list-item bd-depth-style-item ${i === currentIndex ? 'active' : ''}" data-bd-depth-select="${i}" data-bd-depth-item="${i}" draggable="true" title="${tooltip}" aria-label="${tooltip}">
            <span class="bd-style-list-handle" title="ドラッグして並べ替え">⋮⋮</span>
            <span class="bd-style-list-preview">${_bdDepthStylePreviewHtml(style)}</span>
            <span class="bd-style-list-name">${esc(typeof bdDepthStyleDisplayName === 'function' ? bdDepthStyleDisplayName(style, i, styles.length) : `階層 ${i + 1}`)}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="bd-style-manager-popup-actions">
        <button type="button" class="bd-detail-style-action" data-bd-popup-depth-add title="階層を追加">${plusIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-depth-theme title="テーマカラーを階層別スタイルに適用">${paletteIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-depth-save title="現在の階層別スタイル一式を全ボード共通のデフォルトとして保存">${saveIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-depth-reset title="保存したデフォルトに戻す (未保存ならビルトイン初期値)">${resetIcon}</button>
        <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-bd-popup-depth-delete title="削除" ${styles.length <= 1 ? 'disabled' : ''}>${trashIcon}</button>
        ${_bdStyleManagerPopupCloseButtonHtml()}
      </div>`;

    if (typeof opts.refreshAnchor === 'function') {
      const next = opts.refreshAnchor();
      if (next) {
        currentAnchor = next;
        _bdStyleManagerPopupAnchor = next;
      }
    }
    _bdPositionStyleManagerPopup(popup, currentAnchor);

    popup.querySelectorAll('[data-bd-depth-select]').forEach(item => {
      item.addEventListener('click', () => {
        const i = parseInt(item.dataset.bdDepthSelect, 10) || 0;
        opts.currentIndex = i;
        if (typeof opts.onSelect === 'function') opts.onSelect(i);
        render();
      });
    });
    popup.querySelector('[data-bd-popup-close]')?.addEventListener('click', () => {
      _bdCloseStyleManagerPopup();
      _bdFocusStyleManagerPopupAnchor(() => typeof opts.refreshAnchor === 'function' ? (opts.refreshAnchor() || currentAnchor) : currentAnchor);
    });

    popup.querySelectorAll('[data-bd-depth-item]').forEach(item => {
      item.addEventListener('dragstart', () => {
        _bdDepthStyleDragIndex = parseInt(item.dataset.bdDepthItem, 10);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        _bdDepthStyleDragIndex = -1;
        popup.querySelectorAll('[data-bd-depth-item]').forEach(el => el.classList.remove('dragging', 'drag-over'));
      });
      item.addEventListener('dragover', event => { event.preventDefault(); item.classList.add('drag-over'); });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', event => {
        event.preventDefault();
        item.classList.remove('drag-over');
        const targetIndex = parseInt(item.dataset.bdDepthItem, 10);
        if (!Number.isFinite(_bdDepthStyleDragIndex) || !Number.isFinite(targetIndex)) return;
        const arr = bd.depthStyles || [];
        if (_bdDepthStyleDragIndex === targetIndex || _bdDepthStyleDragIndex < 0 || targetIndex < 0) return;
        if (typeof bdPushUndo === 'function') bdPushUndo();
        const [moved] = arr.splice(_bdDepthStyleDragIndex, 1);
        const finalIndex = _bdDepthStyleDragIndex < targetIndex ? targetIndex - 1 : targetIndex;
        arr.splice(finalIndex, 0, moved);
        opts.currentIndex = finalIndex;
        if (typeof opts.onSelect === 'function') opts.onSelect(finalIndex);
        applyDepthStyles(render);
      });
    });

    popup.querySelector('[data-bd-popup-depth-add]')?.addEventListener('click', () => {
      const styles2 = bd.depthStyles || [];
      const last = styles2[styles2.length - 1] || { fontSize: 13, fontBold: false, width: 160, bgColor: '' };
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const next = _bdClone(last);
      const baseName = (last && last.name) ? `${last.name} 2` : `階層 ${styles2.length + 1}`;
      next.name = typeof _bdMakeUniqueStyleName === 'function'
        ? _bdMakeUniqueStyleName(baseName, styles2)
        : baseName;
      bd.depthStyles.push(next);
      opts.currentIndex = bd.depthStyles.length - 1;
      if (typeof opts.onSelect === 'function') opts.onSelect(opts.currentIndex);
      applyDepthStyles(render);
    });

    popup.querySelector('[data-bd-popup-depth-theme]')?.addEventListener('click', () => {
      if (typeof bdApplyThemeColorsToDepthStyles !== 'function') return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      bdApplyThemeColorsToDepthStyles({ applyLineColor: true });
      opts.currentIndex = currentIndex;
      if (typeof opts.onSelect === 'function') opts.onSelect(currentIndex);
      applyDepthStyles(render);
      if (typeof showStatus === 'function') showStatus('テーマカラーを階層別スタイルに適用しました');
    });

    popup.querySelector('[data-bd-popup-depth-delete]')?.addEventListener('click', async () => {
      if ((bd.depthStyles || []).length <= 1) return;
      const deleteIndex = Math.max(0, Math.min(Number.isFinite(+opts.currentIndex) ? +opts.currentIndex : 0, bd.depthStyles.length - 1));
      const target = bd.depthStyles[deleteIndex] || {};
      const label = typeof bdDepthStyleDisplayName === 'function'
        ? bdDepthStyleDisplayName(target, deleteIndex, bd.depthStyles.length)
        : (target.name || `階層 ${deleteIndex + 1}`);
      const ok = typeof cfConfirm === 'function'
        ? await cfConfirm(`階層別スタイル「${label}」を削除しますか？`)
        : (typeof confirm === 'function' ? confirm(`階層別スタイル「${label}」を削除しますか？`) : true);
      if (!ok) return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      bd.depthStyles.splice(deleteIndex, 1);
      opts.currentIndex = Math.max(0, Math.min(deleteIndex, bd.depthStyles.length - 1));
      if (typeof opts.onSelect === 'function') opts.onSelect(opts.currentIndex);
      applyDepthStyles(render);
    });

    popup.querySelector('[data-bd-popup-depth-save]')?.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const snapshot = typeof bdNormalizeDepthStyles === 'function'
        ? bdNormalizeDepthStyles(bd.depthStyles)
        : (bd.depthStyles || []).slice();
      _bdSaveGlobalDepthStyles(snapshot);
      showStatus('階層別スタイルをデフォルトとして保存しました', false, { showSaveDialog: true });
    });

    popup.querySelector('[data-bd-popup-depth-reset]')?.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const global = _bdReadGlobalDepthStyles();
      const globalIsLegacy = typeof _bdIsLegacyDefaultDepthStyles === 'function' && _bdIsLegacyDefaultDepthStyles(global);
      if (Array.isArray(global) && global.length && !globalIsLegacy) {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles(global) : global.slice();
        showStatus('保存したデフォルトに戻しました');
      } else {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles([]) : [];
        showStatus('デフォルトは未保存のため、ビルトイン初期値に戻しました');
      }
      opts.currentIndex = 0;
      if (typeof opts.onSelect === 'function') opts.onSelect(0);
      applyDepthStyles(render);
    });
  };

  render();
  setTimeout(() => {
    _bdStyleManagerPopupCloseHandler = event => {
      if (!_bdStyleManagerPopup) return;
      const anchor = _bdStyleManagerPopupAnchor || currentAnchor;
      if (!_bdStyleManagerPopup.contains(event.target) && !(anchor && anchor.contains(event.target))) {
        _bdCloseStyleManagerPopup();
      }
    };
    document.addEventListener('pointerdown', _bdStyleManagerPopupCloseHandler);
  }, 0);
}

// 旧モーダルは廃止し、オプションパネルの階層別スタイルタブに切り替える (コミットC)。
// window._bdPendingDepthStyleIndex が明示的に指定されていればそのインデックスを初期選択として
// タブを再描画する。未指定の場合は現在の描画状態を尊重し、強制的にインデックス 0 へリセットしない。
function bdOpenDepthStyleManager() {
  if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
  if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
  if (typeof showBoardTabs === 'function') showBoardTabs({ depthStyle: true });
  const pendingIndex = Number.isInteger(window?._bdPendingDepthStyleIndex) ? window._bdPendingDepthStyleIndex : null;
  window._bdPendingDepthStyleIndex = null;
  const el = document.getElementById('detail-tab-board-depth-style');
  if (el && typeof _bdRenderDepthStyleInPanel === 'function') {
    if (pendingIndex !== null) {
      // 呼び出し側が明示的に index を指定 → その階層を初期選択にして再描画
      _bdRenderDepthStyleInPanel(el, pendingIndex);
