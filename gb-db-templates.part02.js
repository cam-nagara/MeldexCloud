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
  if (result.entityLayoutsResult && (result.entityLayoutsResult.added || result.entityLayoutsResult.skipped)) {
    msg += `（トピックレイアウト${result.entityLayoutsResult.added || 0}件追加`;
    if (result.entityLayoutsResult.skipped) msg += `/${result.entityLayoutsResult.skipped}件スキップ（同名）`;
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

