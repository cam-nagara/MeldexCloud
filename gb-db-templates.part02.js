/**
 * テンプレートを適用する
 */
async function _doApplyTemplate(dbPath, tmpl, overlayEl, triggerEl = null) {
  let result;
  try {
    result = applyDbTemplate(dbPath, tmpl);
    if (result.backendSavePromise) await result.backendSavePromise;
  } catch (e) {
    showStatus('テンプレート適用に失敗: ' + (e.message || e), true);
    return;
  }
  _closeDbTemplateOverlay(overlayEl, triggerEl || overlayEl?._dbTemplateTrigger || null);

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
  if (typeof selectDatabase === 'function') selectDatabase(dbPath);
}

/* --- テンプレートプレビューモーダル（モバイル: 重ねモーダルとして継続使用） --- */

function showTemplatePreviewModal(tmpl, dbPath, parentOverlay, triggerEl = null) {
  const trigger = _dbTemplateTrigger(triggerEl);
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const titleId = `db-template-preview-title-${seq}`;
  const descId = `db-template-preview-desc-${seq}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = 'preview';
  overlay.style.zIndex = '130';

  const modal = document.createElement('div');
  modal.className = 'modal db-template-modal db-template-preview-modal';
  modal.dataset.e2eId = 'db-template-preview-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.setAttribute('aria-describedby', descId);
  modal.tabIndex = -1;
  _setDbTemplateModalSize(modal, { maxWidth: 500, maxHeight: 680, heightRatio: 0.74, minHeight: 360 });

  // タイトル
  const h3 = document.createElement('h3');
  h3.id = titleId;
  h3.textContent = tmpl.name;
  modal.appendChild(h3);

  const desc = document.createElement('p');
  desc.id = descId;
  desc.textContent = tmpl.description;
  desc.className = 'db-template-description';
  modal.appendChild(desc);

  // ビュー一覧（savedViews があれば詳細表示、無ければ旧形式の推奨ビュー表示）
  modal.appendChild(_buildDbTemplateViewsSummarySection(tmpl));

  // プロパティ一覧テーブル（デスクトップのプレビューペインと共通の構築関数を使用）
  modal.appendChild(_buildDbTemplatePropTable(tmpl));

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.className = 'db-template-footer';
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-preview-back');
  cancelBtn.textContent = '戻る';
  cancelBtn.addEventListener('click', () => _closeDbTemplateOverlay(overlay, trigger));
  btnRow.appendChild(cancelBtn);
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-preview-apply');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', () => {
    _closeDbTemplateOverlay(overlay, trigger, { restoreFocus: false });
    _doApplyTemplate(dbPath, tmpl, parentOverlay, parentOverlay?._dbTemplateTrigger || trigger);
  });
  btnRow.appendChild(applyBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  _showDbTemplateOverlay(overlay, modal, trigger, modal);
}
