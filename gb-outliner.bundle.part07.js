  });
}

async function _uploadOutlinerDroppedFile(file, parentPath) {
  try {
    const data = await _readOutlinerDroppedFile(file);
    await apiFetch('/upload-file?path=' + encodeURIComponent(parentPath), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, filename: file.name }),
    });
    return { ok: true, name: file.name };
  } catch (error) {
    return {
      ok: false,
      name: file?.name || 'ファイル',
      error: error?.message ? String(error.message) : '取り込みに失敗しました',
    };
  }
}

document.getElementById('outliner-tree')?.addEventListener('drop', async e => {
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
    await _folderImportOsDrop(e, { type: 'folder', path: parentPath || state.vaultPath });
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
  let processed = 0;
  const results = await Promise.all(files.map(async file => {
    const result = await _uploadOutlinerDroppedFile(file, parentPath);
    processed += 1;
    progress?.update?.({ processed: processed, currentItem: file.name });
    return result;
  }));
  try {
    progress?.update?.({ phase: '表示を更新しています', total: null, currentItem: '' });
    await loadOutliner();
  } catch (error) {
    progress?.fail?.({ error: error });
    throw error;
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
});
