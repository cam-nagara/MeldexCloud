    pointerId = e.pointerId;
    pointerCaptured = false;
    selectionScope = _outlinerLassoScopeFromTarget(e.target);
    baseSelection = selectionMode === 'replace' ? [] : [...treeSelection.items];
    const rect = scroller.getBoundingClientRect();
    startX = e.clientX - rect.left + scroller.scrollLeft;
    startY = e.clientY - rect.top + scroller.scrollTop;
    startClientX = e.clientX;
    startClientY = e.clientY;
  });

  scroller.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const distance = Math.max(Math.abs(e.clientX - startClientX), Math.abs(e.clientY - startClientY));
    if (!active && distance < LASSO_DRAG_THRESHOLD) return;
    beginLasso(e);
    const rect = _outlinerLassoRectForEvent(e);
    const { left, top, width, height } = rect;
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    updateSelection(rect);
    e.preventDefault();
  });
  scroller.addEventListener('pointerup', endLasso);
  scroller.addEventListener('pointercancel', endLasso);
})();

async function _uploadOutlinerDroppedFile(file, parentPath) {
  try {
    const [result] = await MeldexDnD.uploadFiles([file], parentPath, { source: 'outliner-drop' });
    return result?.ok ? result : {
      ok: false,
      name: file?.name || 'ファイル',
      error: result?.error || '取り込みに失敗しました',
    };
  } catch (error) {
    return {
      ok: false,
      name: file?.name || 'ファイル',
      error: error?.message ? String(error.message) : '取り込みに失敗しました',
    };
  }
}

// 行・ツリーへのOSドロップ取込。読み取りや取り込みの途中で失敗しても、原因つきで表示する。
async function _outlinerImportOsDropSafely(event, targetItem) {
  try {
    return await _folderImportOsDrop(event, targetItem);
  } catch (error) {
    console.error('[outliner drop] 取り込みに失敗', error);
    if (typeof _outlinerReportFailure === 'function') _outlinerReportFailure('ファイルを取り込めませんでした', error);
    else showStatus('ファイルを取り込めませんでした', true);
    return 0;
  }
}

async function _outlinerHandleTreeOsDrop(e) {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || []); if (!files.length) return;
  let parentPath = '';
  // ドロップ先のフォルダを検出
  const nodeEl = e.target?.closest?.('.tree-node');
  if (nodeEl && nodeEl._nodeData) {
    const nd = nodeEl._nodeData;
    if (nd.type === 'folder' || nd.type === 'database') parentPath = nd.path;
    else parentPath = nd.path.substring(0, nd.path.lastIndexOf('/'));
  }
  if (typeof _folderImportOsDrop === 'function') {
    await _outlinerImportOsDropSafely(e, { type: 'folder', path: parentPath || state.vaultPath });
    return;
  }
  const progress = window.MeldexOperationProgress?.begin?.({
    kind: 'file-import',
    label: `${files.length}個のファイルをインポートしています`,
    mode: 'determinate',
    total: files.length,
    processed: 0,
    origin: document.getElementById('outliner-tree'),
    showInTray: true,
    priority: 40,
  });
  if (!progress) showStatus(`${files.length}個のファイルをインポート中...`);
  let results;
  try {
    results = await MeldexDnD.uploadFiles(files, parentPath, { source: 'outliner-drop' });
  } catch (error) {
    console.error('[outliner drop] 取り込みに失敗', error);
    progress?.fail?.({ error: error });
    _outlinerReportFailure('ファイルを取り込めませんでした', error);
    return;
  }
  results.forEach((result, index) => {
    progress?.update?.({ processed: index + 1, currentItem: result.name || files[index]?.name || '' });
  });
  try {
    progress?.update?.({ phase: '表示を更新しています', total: null, currentItem: '' });
    await loadOutliner();
  } catch (error) {
    // 取り込み自体は済んでいる。表示の更新失敗を取り込み失敗と混同させない。
    console.error('[outliner drop] 表示の更新に失敗', error);
    progress?.fail?.({ error: error });
    _outlinerReportFailure('ファイルは取り込みましたが、ツリーの表示を更新できませんでした', error);
    return;
  }
  const succeeded = results.filter(result => result.ok);
  const failed = results.filter(result => !result.ok);
  if (failed.length) {
    const names = failed.slice(0, 3).map(result => result.name).join('、');
    const suffix = failed.length > 3 ? ` ほか${failed.length - 3}件` : '';
    const summary = `${succeeded.length}個をインポート、${failed.length}個は失敗しました: ${names}${suffix}`;
    if (progress) {
      progress.partial({
        summary: summary,
        detailCount: failed.length,
        details: failed.map(result => ({ path: result.name, message: result.error })),
      });
    } else showStatus(summary, true);
  } else {
    if (progress) progress.succeed({ summary: files.length + '個のファイルをインポートしました' });
    else showStatus(files.length + '個のファイルをインポートしました');
  }
}

document.getElementById('outliner-tree')?.addEventListener('drop', e => _outlinerHandleTreeOsDrop(e));
