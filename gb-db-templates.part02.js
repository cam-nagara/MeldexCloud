/**
 * テンプレートを適用する
 */
async function _doApplyTemplate(dbPath, tmpl, overlayEl, triggerEl = null) {
  if (overlayEl?._dbTemplateBusy) return false;
  if (overlayEl) overlayEl._dbTemplateBusy = true;
  overlayEl?._dbTemplateSetBusy?.(true);
  let result;
  try {
    result = applyDbTemplate(dbPath, tmpl);
    if (result.backendSavePromise) await result.backendSavePromise;
  } catch (e) {
    showStatus('テンプレート適用に失敗: ' + (e.message || e), true);
    if (overlayEl) overlayEl._dbTemplateBusy = false;
    overlayEl?._dbTemplateSetBusy?.(false);
    return false;
  }
  _closeDbTemplateOverlay(overlayEl, triggerEl || overlayEl?._dbTemplateTrigger || null, { reason: 'applied' });

  let msg = 'テンプレート「' + tmpl.name + '」を適用しました';
  if (result.skipped.length > 0) {
    msg += '（' + result.skipped.length + '件スキップ: 既存の列）';
  }
  if (result.viewsResult && (result.viewsResult.added || result.viewsResult.skipped)) {
    msg += `（ビュー${result.viewsResult.added || 0}件追加`;
    if (result.viewsResult.skipped) msg += `/${result.viewsResult.skipped}件スキップ`;
    msg += '）';
  }
  showStatus(msg);

  // DB再読み込み
  if (typeof selectDatabase === 'function') {
    try {
      await Promise.resolve(selectDatabase(dbPath));
    } catch (error) {
      showStatus('テンプレートは適用済みですが、シートの再読み込みに失敗しました: ' + (error?.message || error), true);
    }
  }
  return true;
}

/* --- テンプレートプレビューモーダル（モバイル: 重ねモーダルとして継続使用） --- */

function showTemplatePreviewModal(tmpl, dbPath, parentOverlay, triggerEl = null) {
  const trigger = _dbTemplateTrigger(triggerEl);
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const descId = `db-template-preview-desc-${seq}`;
  const body = document.createElement('div');
  body.className = 'db-template-preview-content';

  const desc = document.createElement('p');
  desc.id = descId;
  desc.textContent = tmpl.description;
  desc.className = 'db-template-description';
  body.appendChild(desc);

  // ビュー一覧（savedViews があれば詳細表示、無ければ旧形式の推奨ビュー表示）
  body.appendChild(_buildDbTemplateViewsSummarySection(tmpl));

  // プロパティ一覧テーブル（デスクトップのプレビューペインと共通の構築関数を使用）
  body.appendChild(_buildDbTemplatePropTable(tmpl));

  // ボタン
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-preview-back');
  cancelBtn.textContent = '戻る';
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-preview-apply');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', async () => {
    const applied = await _doApplyTemplate(dbPath, tmpl, overlay, trigger);
    if (applied) {
      _closeDbTemplateOverlay(parentOverlay, parentOverlay?._dbTemplateTrigger || trigger, { reason: 'applied' });
    }
  });
  let busy = false;
  const releaseOverflowLock = _lockDbTemplateHorizontalOverflow();
  const modalApi = window.GBUI.createModal({
    id: `db-template-preview-${seq}`,
    title: tmpl.name,
    body,
    footer: [cancelBtn, applyBtn],
    variant: 'standard',
    extraClass: 'db-template-preview-modal',
    geometryKey: 'db-template-preview',
    minWidth: '0',
    initialFocus: cancelBtn,
    returnFocus: trigger || undefined,
    closeLabel: 'テンプレートプレビューを閉じる',
    onBeforeClose: reason => !busy || reason === 'applied' || reason === 'superseded',
    onClose: releaseOverflowLock,
  });
  const overlay = modalApi.overlay;
  const modal = modalApi.modal;
  modal.classList.add('modal', 'db-template-modal');
  overlay.classList.add('modal-overlay');
  overlay.dataset.dbTemplateModal = 'preview';
  overlay.style.zIndex = '130';
  overlay._dbTemplateTrigger = trigger;
  overlay._dbTemplateClose = modalApi.close;
  overlay._dbTemplateSetBusy = (next) => {
    busy = !!next;
    modal.setAttribute('aria-busy', busy ? 'true' : 'false');
    [cancelBtn, applyBtn, modalApi.header.querySelector('.gb-modal-close')].filter(Boolean)
      .forEach(control => { control.disabled = busy; });
  };
  modal.dataset.e2eId = 'db-template-preview-dialog';
  modal.setAttribute('aria-describedby', descId);
  modalApi.footer.classList.add('db-template-footer');
  const closeBtn = modalApi.header.querySelector('.gb-modal-close');
  if (closeBtn) closeBtn.dataset.e2eId = 'db-template-preview-close';
  cancelBtn.addEventListener('click', () => modalApi.close('back'));
  _setDbTemplateModalSize(modal, { maxWidth: 500, maxHeight: 680, heightRatio: 0.74, minHeight: 360 });
  modalApi.open();
}
