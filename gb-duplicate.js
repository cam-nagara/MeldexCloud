/**
 * Meldex Duplicate Detection & CLIP Image Search
 * 重複検出の画面と監視は gb-duplicate-monitor.js に分離する。
 */

async function showDuplicateScanModal(folderPath) {
  if (!window.MeldexDuplicateMonitor?.openManualScan) {
    showStatus('重複ファイルの画面を読み込めませんでした。Meldexを再読み込みしてください。', true);
    return null;
  }
  return window.MeldexDuplicateMonitor.openManualScan(folderPath || '');
}


// ==============================
// CLIP 画像類似検索
// ==============================

async function clipIndexFolder(folderPath) {
  showStatus('画像インデックスを作成中...');
  try {
    const res = await apiPost('/clip/index', { path: folderPath });
    showStatus(`インデックス完了: ${res.processed} 枚処理 / ${res.skipped} 枚スキップ / 合計 ${res.total} 枚`);
    return res;
  } catch (e) {
    showStatus('インデックス作成失敗: ' + (e.message || e), true);
    return null;
  }
}

async function clipSearchImages(query, folder) {
  try {
    const res = await apiPost('/clip/search', { query, top_k: 20, folder: folder || '' });
    return res;
  } catch (e) {
    showStatus('画像検索失敗: ' + (e.message || e), true);
    return null;
  }
}

function showClipSearchResults(results, query) {
  if (!results || !results.results || results.results.length === 0) {
    const message = results?.message ? `<div class="gb-section-desc">${esc(results.message)}</div>` : '';
    return `「${esc(query)}」に該当する画像は見つかりませんでした。${message}`;
  }
  let html = `<div class="gb-section-desc" style="margin-bottom:var(--ui-space-3);">「${esc(query)}」の検索結果（${results.results.length} 件）</div>`;
  html += '<div class="clip-search-grid">';
  results.results.forEach((r, index) => {
    const thumbUrl = API_BASE + '/thumb?path=' + encodeURIComponent(r.path) + '&size=120';
    const score = Math.round(r.score * 100);
    html += `<div class="clip-search-item" role="button" tabindex="0" data-clip-search-result data-path="${esc(r.path)}" data-e2e-id="clip-search-result-${index}" aria-label="${esc(r.name)} を開く">
      <img class="clip-search-thumb" src="${thumbUrl}" alt="${esc(r.name)}" onerror="this.alt='読込失敗';">
      <div class="clip-search-name" title="${esc(r.path)}">${esc(r.name)}</div>
      <div class="clip-search-score">類似度: ${score}%</div>
    </div>`;
  });
  html += '</div>';
  return html;
}

function _openClipViewerResult(e) {
  const el = e?.target?.closest('[data-clip-search-result][data-path]');
  const p = el?.dataset?.path;
  if (p) openViewer('/viewer?file=' + encodeURIComponent(p));
}

function _bindClipSearchResultDelegation() {
  if (window.__MeldexClipSearchResultDelegated) return;
  window.__MeldexClipSearchResultDelegated = true;
  document.addEventListener('click', event => {
    const item = event.target?.closest?.('[data-clip-search-result][data-path]');
    if (!item) return;
    _openClipViewerResult({ target: item });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target?.closest?.('[data-clip-search-result][data-path]');
    if (!item) return;
    event.preventDefault();
    _openClipViewerResult({ target: item });
  });
}

_bindClipSearchResultDelegation();
