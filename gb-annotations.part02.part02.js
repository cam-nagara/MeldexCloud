async function annClear() {
  if (!await cfConfirm('この画面の注釈をすべて削除しますか？')) return;
  const embedded = _usesEmbeddedAnnotationSurface(_getAnnotationViewName());
  const overlay = embedded ? null : document.getElementById('ann-overlay');
  const bridge = embedded ? _getBoardAnnotationControl() : null;
  let historyBefore = [];
  if (ann.targetPath) {
    try {
      historyBefore = await apiFetch(_annotationTargetFetchUrl(ann.targetPath));
    } catch {}
  }
  const ids = new Set();
  const softDeleted = new Map();
  overlay?.querySelectorAll('[data-ann-id],[data-ann-pending]').forEach(el => {
    if (el.dataset.annId) ids.add(el.dataset.annId);
    el.dataset.deleted = '1';
    el.remove();
  });
  bridge?.layer?.querySelectorAll('[data-ann-id],[data-ann-client-id]').forEach(el => {
    if (el.dataset.annId) ids.add(el.dataset.annId);
    el.dataset.deleted = '1';
    el.remove();
  });
  document.querySelectorAll(embedded ? '.ann-note.ann-note-embedded' : '.ann-note:not(.ann-note-embedded)').forEach(el => {
    if (el.dataset.annId) {
      const deletedData = { ...(el._annData || {}), deleted: true, deletedAt: new Date().toISOString() };
      if (el._annData) Object.assign(el._annData, deletedData);
      el.dataset.deleted = '1';
      el._annCancelPendingSave?.();
      softDeleted.set(el.dataset.annId, deletedData);
      ids.delete(el.dataset.annId);
    }
    el.remove();
  });
  if (embedded && ann.targetPath) {
    try {
      const items = await apiFetch(_annotationTargetFetchUrl(ann.targetPath));
      (items || []).forEach(item => {
        if (!item?.id) return;
        const data = _parseAnnotationData(item);
        if (data == null) return;
        if (_isStandaloneAnnotationNoteItem(item, data)) {
          softDeleted.set(item.id, { ...data, deleted: true, deletedAt: new Date().toISOString() });
          ids.delete(item.id);
        } else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') {
          return;
        } else {
          ids.add(item.id);
        }
      });
    } catch {}
  }
  const operations = [
    ...[...ids].filter(id => !softDeleted.has(id)).map(id => apiDelete('/annotations/' + encodeURIComponent(id))),
    ...[...softDeleted.entries()].map(([id, data]) => apiPut('/annotations/' + encodeURIComponent(id), { data })),
  ];
  const results = await Promise.allSettled(operations);
  const failedCount = results.filter(result => result.status === 'rejected').length;
  let historyAfter = [];
  if (ann.targetPath) {
    try {
      historyAfter = await apiFetch(_annotationTargetFetchUrl(ann.targetPath));
    } catch {}
  }
  if (typeof _pushAnnotationBatchHistory === 'function') {
    _pushAnnotationBatchHistory('注釈: 全削除', historyBefore, historyAfter, ann.targetPath);
  }
  _markAnnotationMutated(ann.targetPath);
  if (failedCount) {
    if (typeof loadAnnotations === 'function' && !embedded) loadAnnotations();
    else if (embedded && typeof _loadAnnotationsToIframe === 'function') _loadAnnotationsToIframe();
    showStatus(`注釈を一部削除できませんでした（${failedCount}件）`, true);
    return;
  }
  showStatus('注釈を全削除しました');
}

// Alt+A → gb-shortcuts.js の中央ハンドラに移行済み

// ==============================
// アノテーション管理ビュー
// ==============================
async function openAnnotationManager() {
  if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
  else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
  if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
}

function jumpToAnnotation(targetPath) {
  // ターゲットパスからビューを推定して移動
  document.querySelector('.modal-overlay')?.remove();
  if (!targetPath) {
    showStatus('注釈の対象ファイルが見つかりません', true);
    return;
  }
  if (targetPath === 'calendar:panel') {
    if (typeof openCalendar === 'function') openCalendar();
    else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('calendar');
  } else if (targetPath.startsWith('compare:')) {
    const pair = targetPath.slice('compare:'.length).split('|');
    if (pair[0] && pair[1] && typeof openCompareView === 'function') openCompareView(pair[0], pair[1]).catch?.(() => {});
    else showStatus('比較ビューの注釈対象が見つかりません', true);
  } else if (targetPath.endsWith('.mel-sheet') || targetPath.endsWith('.smart-db.json')) {
    const label = targetPath.split('/').pop().replace(/\.mel-sheet$/i, '').replace(/\.smart-db\.json$/i, '');
    if (typeof openSmartDbFile === 'function') openSmartDbFile(label, targetPath);
    else selectDatabase(targetPath);
  } else if (targetPath.endsWith('.mel-board') || targetPath.endsWith('.board.md')) {
    const label = targetPath.split('/').pop().replace(/\.mel-board$/i, '').replace(/\.board\.md$/i, '');
    if (typeof openBoard === 'function') openBoard(label, targetPath);
    else openPage(label, targetPath);
  } else if (targetPath.includes('/設定/') || targetPath.includes('/DB')) {
    selectDatabase(targetPath);
  } else if (targetPath.endsWith('.mel-scenario') || targetPath.endsWith('.scriptnote.json') || targetPath.endsWith('.scenario.json')) {
    if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(targetPath, targetPath.split('/').pop());
  } else {
    openPage(targetPath.split('/').pop(), targetPath);
  }
}
